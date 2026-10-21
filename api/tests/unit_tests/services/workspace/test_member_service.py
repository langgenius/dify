"""Membership and invitation behavior across the application/persistence boundary."""

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import timedelta
from threading import Event, Lock, current_thread
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy import delete, event, select, update
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models import (
    WorkspaceOwnerTransferNotification as WorkspaceOwnerTransferNotificationModel,
)
from models import (
    WorkspaceOwnerTransferOperation,
)
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.model import App, DifySetup
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.account_errors import AccountNotFoundError
from services.enterprise.rbac_service import RBACService
from services.entities.feature_entities import FeatureModel
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    AccountAlreadyInTenantError,
    CannotOperateSelfError,
    InvalidOwnerTransferCodeError,
    InvalidOwnerTransferEmailError,
    InvalidOwnerTransferTokenError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    RoleAlreadyAssignedError,
    WorkspaceAlreadyHasOwnerError,
    WorkspaceInvitationQuotaError,
    WorkspaceNotFoundError,
    WorkspaceOwnerTransferInProgressError,
)
from services.feature_service import FeatureService
from services.rbac.contracts import MemberRolesResponse, Paginated, RBACRole
from services.workspace.contracts import (
    OwnerTransferToken,
    WorkspaceOwnerTransfer,
    WorkspaceOwnerTransferNotification,
    WorkspaceOwnerTransferNotificationDetails,
)
from services.workspace.gateways import (
    DeploymentWorkspaceMemberAccessGateway,
    WorkspaceInvitationGateway,
)
from services.workspace.member_service import (
    OwnerTransferGateway,
    OwnerTransferNotificationGateway,
    WorkspaceInvitationService,
    WorkspaceMemberService,
    WorkspaceOwnerTransferNotificationService,
    WorkspaceOwnerTransferRecoveryService,
    WorkspaceOwnerTransferService,
)
from services.workspace.quota import DeploymentQuotaSnapshot, WorkspaceMemberQuotaSnapshot
from tests.unit_tests.account_domain import AccountDomain


def _notification_service(account_domain: AccountDomain) -> WorkspaceOwnerTransferNotificationService:
    return WorkspaceOwnerTransferNotificationService(
        workspaces=account_domain.workspaces,
        gateway=create_autospec(OwnerTransferNotificationGateway, instance=True),
    )


@pytest.fixture
def members(sqlite_session: Session) -> tuple[str, str, str]:
    owner = Account(name="Owner", email="owner@example.com")
    member = Account(name="Member", email="member@example.com")
    tenant = Tenant(name="Workspace")
    sqlite_session.add_all(
        [
            owner,
            member,
            tenant,
            TenantAccountJoin(account_id=owner.id, tenant_id=tenant.id, role=TenantAccountRole.OWNER, current=True),
            TenantAccountJoin(account_id=member.id, tenant_id=tenant.id, role=TenantAccountRole.NORMAL),
        ]
    )
    sqlite_session.commit()
    return tenant.id, owner.id, member.id


@pytest.mark.parametrize("existing_member", [True, False])
def test_join_rejects_a_second_owner_without_changing_membership(
    account_domain: AccountDomain, members: tuple[str, str, str], existing_member: bool
) -> None:
    workspace_id, owner_id, member_id = members
    if existing_member:
        account = account_domain.accounts.get_account_by_id(member_id)
        assert account is not None
    else:
        account = account_domain.accounts.create_account("new-owner@example.com", "New owner", "en-US")

    with pytest.raises(WorkspaceAlreadyHasOwnerError, match="Tenant already has an owner"):
        account_domain.members.join_member(
            workspace_id=workspace_id,
            account_id=account.id,
            email=account.email,
            role=TenantAccountRole.OWNER,
            operator_account_id=owner_id,
        )

    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert account_domain.members.get_role(workspace_id, account.id) == (
        TenantAccountRole.NORMAL if existing_member else None
    )
    account_domain.access.membership_changed.assert_not_called()


@pytest.mark.parametrize(
    ("status", "other_workspace", "deleted"),
    [("pending", False, True), ("pending", True, False), ("active", False, False)],
)
def test_removal_deletes_only_orphaned_pending_accounts(
    account_domain: AccountDomain,
    sqlite_session: Session,
    members: tuple[str, str, str],
    status: str,
    other_workspace: bool,
    deleted: bool,
) -> None:
    workspace_id, owner_id, member_id = members
    member = sqlite_session.get(Account, member_id)
    assert member is not None
    member.status = AccountStatus(status)
    if other_workspace:
        tenant = Tenant(name="Other")
        sqlite_session.add_all(
            [tenant, TenantAccountJoin(account_id=member_id, tenant_id=tenant.id, role=TenantAccountRole.NORMAL)]
        )
    sqlite_session.commit()
    sqlite_session.expunge_all()
    account_domain.members.remove(workspace_id, member_id, owner_id)
    assert (sqlite_session.get(Account, member_id) is None) == deleted
    assert account_domain.members.get_role(workspace_id, member_id) is None
    account_domain.access.member_removed.assert_called_once()
    assert account_domain.access.member_removed.call_args.args[1].account_deleted == deleted


@pytest.mark.parametrize("action", ["add", "remove", "update"])
def test_self_operations_and_non_administrators_are_denied(
    account_domain: AccountDomain, members: tuple[str, str, str], action: str
) -> None:
    workspace_id, owner_id, member_id = members
    with pytest.raises(CannotOperateSelfError):
        account_domain.members.check_permission(workspace_id, owner_id, owner_id, action)
    with pytest.raises(NoPermissionError):
        account_domain.members.check_permission(workspace_id, member_id, owner_id, action)


def test_owner_transfer_demotes_previous_owner(account_domain: AccountDomain, members: tuple[str, str, str]) -> None:
    workspace_id, owner_id, member_id = members
    account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.NORMAL
    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.OWNER


@pytest.mark.parametrize("new_role", ["normal", "owner"])
def test_admin_cannot_change_owner_or_promote_owner(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session, new_role: str
) -> None:
    workspace_id, owner_id, member_id = members
    membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == member_id))
    assert membership is not None
    membership.role = TenantAccountRole.ADMIN
    sqlite_session.commit()
    with pytest.raises(NoPermissionError):
        account_domain.members.update_role(workspace_id, owner_id, new_role, member_id)


def test_unchanged_role_does_not_sync(account_domain: AccountDomain, members: tuple[str, str, str]) -> None:
    workspace_id, owner_id, member_id = members
    with pytest.raises(RoleAlreadyAssignedError):
        account_domain.members.update_role(workspace_id, member_id, "normal", owner_id)
    account_domain.access.change_role.assert_not_called()


@pytest.mark.parametrize("role", ["invalid", "dataset_operator"])
def test_role_policy_prevents_persistence_and_rbac_changes(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    config_overrides: Callable[..., None],
    role: str,
) -> None:
    config_overrides(DATASET_OPERATOR_ENABLED=False)
    account_domain.access.ensure_role_enabled.side_effect = DeploymentWorkspaceMemberAccessGateway().ensure_role_enabled
    workspace_id, owner_id, member_id = members

    with pytest.raises(InvalidWorkspaceMemberRoleError):
        account_domain.members.update_role(workspace_id, member_id, role, owner_id)

    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.NORMAL
    account_domain.access.change_role.assert_not_called()


@pytest.mark.parametrize("operation", ["remove", "update_role"])
@pytest.mark.parametrize("account_exists", [True, False])
def test_member_operations_distinguish_missing_account_from_missing_membership(
    account_domain: AccountDomain, members: tuple[str, str, str], operation: str, account_exists: bool
) -> None:
    workspace_id, owner_id, _ = members
    account_id = "00000000-0000-0000-0000-000000000000"
    if account_exists:
        account_id = account_domain.accounts.create_account("outsider@example.com", "Outsider", "en-US").id

    error = MemberNotInTenantError if account_exists else AccountNotFoundError
    if operation == "remove":
        with pytest.raises(error):
            account_domain.members.remove(workspace_id, account_id, owner_id)
    else:
        with pytest.raises(error):
            account_domain.members.update_role(workspace_id, account_id, "editor", owner_id)

    account_domain.access.member_removed.assert_not_called()
    account_domain.access.change_role.assert_not_called()


@pytest.mark.parametrize(
    ("permission", "owner", "allowed"), [(True, False, True), (False, False, False), (True, True, False)]
)
def test_rbac_member_removal_uses_permissions_and_owner_protection(
    account_domain: AccountDomain, members: tuple[str, str, str], permission: bool, owner: bool, allowed: bool
) -> None:
    workspace_id, owner_id, member_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.permission_keys.return_value = {"workspace.member.manage"} if permission else set()
    account_domain.access.is_owner.return_value = owner
    account_domain.access.owner_id.return_value = owner_id
    if allowed:
        account_domain.members.remove(workspace_id, member_id, owner_id)
        assert account_domain.members.get_role(workspace_id, member_id) is None
    else:
        with pytest.raises(NoPermissionError):
            account_domain.members.remove(workspace_id, member_id, owner_id)


def test_new_invitation_normalizes_email_and_sets_current_workspace(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, _ = members
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, 1, 1)
    result = account_domain.invitations.invite(
        RequestContext("request", None, owner_id, workspace_id), "New@Example.com", "en-US", "editor"
    )
    assert result.token == "invitation-token"
    assert result.email == "new@example.com"
    assert result.workspace_id == workspace_id
    assert result.role == "editor"
    invitee = account_domain.repository.find_by_email("new@example.com")
    assert invitee is not None
    assert result.account_id == invitee.id
    assert invitee.status == "pending"
    assert account_domain.members.get_role(workspace_id, invitee.id) == TenantAccountRole.EDITOR
    membership = account_domain.workspaces.find_membership(invitee.id, workspace_id)
    assert membership is not None
    assert membership.current
    invitation = account_domain.delivery.create.call_args.args[0]
    assert invitation.requires_setup is True
    assert invitation.email == "new@example.com"
    assert list(sqlite_session.scalars(select(Tenant.id))) == [workspace_id]


def test_bulk_invitation_deduplicates_equivalent_normalized_emails(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["User.Name+first@Gmail.com", "username@gmail.com"],
        language="en-US",
        role="normal",
    )

    assert [(result.email, result.status) for result in results] == [("user.name+first@gmail.com", "success")]
    account_domain.delivery.create.assert_called_once()
    account_domain.delivery.send.assert_called_once()


def test_new_invitation_still_enforces_deployment_seat_quota(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, _ = members
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(2, 2, 1, 1)

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["new@example.com"],
        language="en-US",
        role="normal",
    )

    assert [(result.email, result.status, result.message) for result in results] == [
        ("new@example.com", "failed", "licensed seats limit exceeded")
    ]
    assert account_domain.repository.find_by_email("new@example.com") is None
    assert len(account_domain.workspaces.list_for_workspace(workspace_id)) == 2
    account_domain.delivery.create.assert_not_called()


def test_active_invitee_must_accept_before_joining(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members
    account = account_domain.accounts.create_account("new@example.com", "New", "en-US")
    account_domain.invitations.invite(RequestContext("request", None, owner_id, workspace_id), account.email, None)
    assert account_domain.members.get_role(workspace_id, account.id) is None
    assert account_domain.delivery.create.call_args.args[0].requires_setup is False


def test_pending_member_can_be_reinvited(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, member_id = members
    account = sqlite_session.get(Account, member_id)
    assert account is not None
    account.status = AccountStatus.PENDING
    sqlite_session.commit()
    account_domain.invitations.invite(RequestContext("request", None, owner_id, workspace_id), account.email, None)
    assert account_domain.delivery.create.call_args.args[0].requires_setup is True


def test_active_member_is_reported_without_sending_invitation(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members
    with pytest.raises(AccountAlreadyInTenantError):
        account_domain.invitations.invite(
            RequestContext("request", None, owner_id, workspace_id), "member@example.com", None
        )
    account_domain.delivery.send.assert_not_called()


def test_removal_transfers_maintainers_only_in_the_target_workspace(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, member_id = members
    other = Tenant(name="Other workspace")
    sqlite_session.add(other)
    apps = [
        App(
            tenant_id=tenant_id,
            name="App",
            mode="chat",
            maintainer=member_id,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        for tenant_id in (workspace_id, other.id)
    ]
    datasets = [
        Dataset(tenant_id=tenant_id, name="Dataset", created_by=member_id, maintainer=member_id)
        for tenant_id in (workspace_id, other.id)
    ]
    sqlite_session.add_all([*apps, *datasets])
    sqlite_session.commit()

    account_domain.members.remove(workspace_id, member_id, owner_id)

    sqlite_session.expire_all()
    assert [app.maintainer for app in apps] == [owner_id, member_id]
    assert [dataset.maintainer for dataset in datasets] == [owner_id, member_id]


def test_community_invitation_continues_after_a_historical_duplicate_email(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, _ = members
    sqlite_session.add_all(
        [
            Account(name="First", email="duplicate@example.com"),
            Account(name="Second", email="duplicate@example.com"),
        ]
    )
    sqlite_session.commit()
    account_domain.delivery.acquire.return_value = nullcontext()

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["duplicate@example.com", "valid@example.com"],
        language=None,
        role="normal",
    )

    assert [result.status for result in results] == ["failed", "success"]
    account_domain.delivery.check_capacity.assert_not_called()
    account_domain.delivery.send.assert_called_once()
    assert account_domain.repository.find_by_email("valid@example.com") is not None


def test_bulk_invitation_reports_seat_exhaustion_without_discarding_other_results(
    account_domain: AccountDomain,
    sqlite_session: Session,
    members: tuple[str, str, str],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(FeatureService, "get_features", Mock(return_value=FeatureModel()))
    redis = create_autospec(RedisClientWrapper, instance=True)
    gateway = WorkspaceInvitationGateway(
        tokens=RedisInvitationTokenStore(redis=redis),
        redis=redis,
    )
    workspace_id, owner_id, _ = members
    account_domain.accounts.create_account("outside@example.com", "Outside", "en-US")
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.delivery.check_capacity.side_effect = gateway.check_capacity
    account_domain.delivery.requires_capacity_check = True
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(3, 3, None, 0)

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["new@example.com", "outside@example.com", "member@example.com"],
        language=None,
        role="normal",
    )

    assert [(result.email, result.status) for result in results] == [
        ("new@example.com", "failed"),
        ("outside@example.com", "success"),
        ("member@example.com", "already_member"),
    ]
    assert results[0].message == "licensed seats limit exceeded"
    account_domain.delivery.check_capacity.assert_called_once_with(
        workspace_id, current_members=2, new_members=2, new_accounts=1
    )
    assert account_domain.repository.find_by_email("new@example.com") is None
    account_domain.delivery.create.assert_called_once()
    account_domain.delivery.send.assert_called_once()


def test_bulk_invitation_preserves_committed_invitation_when_last_seat_is_taken(
    account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session
) -> None:
    workspace_id, owner_id, _ = members
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(3, 2, 1, 1)

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["accepted@example.com", "over-capacity@example.com"],
        language="en-US",
        role="normal",
    )

    assert [(result.email, result.status) for result in results] == [
        ("accepted@example.com", "success"),
        ("over-capacity@example.com", "failed"),
    ]
    assert results[0].token == "invitation-token"
    assert results[1].message == "licensed seats limit exceeded"
    accepted = account_domain.repository.find_by_email("accepted@example.com")
    assert accepted is not None
    assert account_domain.members.get_role(workspace_id, accepted.id) == TenantAccountRole.NORMAL
    assert account_domain.repository.find_by_email("over-capacity@example.com") is None
    assert len(account_domain.workspaces.list_for_workspace(workspace_id)) == 3
    account_domain.delivery.create.assert_called_once()
    account_domain.delivery.send.assert_called_once_with(
        language="en-US",
        email="accepted@example.com",
        token=results[0].token,
        inviter_name="Owner",
        workspace_name="Workspace",
    )


def test_bulk_invitation_preserves_committed_invitation_when_last_member_slot_is_taken(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.member_quotas.snapshot.return_value = WorkspaceMemberQuotaSnapshot(
        plan_limit=3,
        plan_usage=2,
        license_limit=None,
        license_usage=0,
    )

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["accepted@example.com", "over-capacity@example.com"],
        language="en-US",
        role="normal",
    )

    assert [(result.email, result.status) for result in results] == [
        ("accepted@example.com", "success"),
        ("over-capacity@example.com", "failed"),
    ]
    assert results[1].message == "Workspace invitation quota exceeded"
    accepted = account_domain.repository.find_by_email("accepted@example.com")
    assert accepted is not None
    assert account_domain.members.get_role(workspace_id, accepted.id) == TenantAccountRole.NORMAL
    assert account_domain.repository.find_by_email("over-capacity@example.com") is None
    assert len(account_domain.workspaces.list_for_workspace(workspace_id)) == 3
    account_domain.delivery.create.assert_called_once()
    account_domain.delivery.send.assert_called_once_with(
        language="en-US",
        email="accepted@example.com",
        token=results[0].token,
        inviter_name="Owner",
        workspace_name="Workspace",
    )


def test_bulk_invitation_capacity_rejection_precedes_all_writes(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.delivery.requires_capacity_check = True
    account_domain.delivery.check_capacity.side_effect = WorkspaceInvitationQuotaError()

    with pytest.raises(WorkspaceInvitationQuotaError):
        account_domain.invitations.invite_many(
            RequestContext("request", None, owner_id, workspace_id),
            emails=["new@example.com"],
            language=None,
            role="normal",
        )

    assert account_domain.repository.find_by_email("new@example.com") is None
    account_domain.delivery.create.assert_not_called()
    account_domain.delivery.send.assert_not_called()


def test_bulk_invitation_retains_partial_results_under_workspace_lock(
    account_domain: AccountDomain, members: tuple[str, str, str]
) -> None:
    workspace_id, owner_id, _ = members
    account_domain.delivery.acquire.return_value = nullcontext()
    account_domain.delivery.send.side_effect = [None, RuntimeError("Mail unavailable")]

    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["new@example.com", "member@example.com", "failed@example.com"],
        language=None,
        role="normal",
    )

    assert [(result.email, result.status) for result in results] == [
        ("new@example.com", "success"),
        ("member@example.com", "already_member"),
        ("failed@example.com", "failed"),
    ]
    assert results[-1].message == "Mail unavailable"
    account_domain.delivery.acquire.assert_called_once_with(workspace_id)
    assert account_domain.repository.find_by_email("new@example.com") is not None
    assert account_domain.repository.find_by_email("failed@example.com") is not None


def test_bulk_invitation_does_not_persist_account_when_account_write_fails(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id, owner_id, _ = members
    account_domain.delivery.acquire.return_value = nullcontext()

    def fail_account_write(_creation: object, **_kwargs: object) -> None:
        raise RuntimeError("account write failed")

    monkeypatch.setattr(account_domain.repository, "create_workspace_member", fail_account_write)
    results = account_domain.invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=["new@example.com"],
        language=None,
        role="normal",
    )

    assert results[0].status == "failed"
    assert account_domain.repository.find_by_email("new@example.com") is None


@pytest.fixture
def owner_transfer(account_domain: AccountDomain) -> tuple[WorkspaceOwnerTransferService, Mock]:
    challenges = create_autospec(OwnerTransferGateway, instance=True)
    challenges.is_ip_limited.return_value = False
    challenges.is_verification_limited.return_value = False
    challenges.read_token.return_value = OwnerTransferToken("owner@example.com", "123456")
    challenges.issue_token.return_value = "promoted-token"
    return WorkspaceOwnerTransferService(
        accounts=account_domain.repository,
        workspaces=account_domain.workspaces,
        members=account_domain.members,
        challenges=challenges,
    ), challenges


@pytest.mark.parametrize(
    ("challenge", "code", "error"),
    [
        (None, "123456", InvalidOwnerTransferTokenError),
        (OwnerTransferToken("other@example.com", "123456"), "123456", InvalidOwnerTransferEmailError),
        (OwnerTransferToken("owner@example.com", "123456"), "000000", InvalidOwnerTransferCodeError),
    ],
)
def test_owner_verification_failure_preserves_challenge(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    challenge: OwnerTransferToken | None,
    code: str,
    error: type[Exception],
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, _ = members
    challenges.read_token.return_value = challenge
    with pytest.raises(error):
        service.verify_code(RequestContext("request", None, owner_id, workspace_id), token="challenge", code=code)
    challenges.revoke_token.assert_not_called()
    challenges.issue_token.assert_not_called()
    if error is InvalidOwnerTransferCodeError:
        challenges.record_verification_failure.assert_called_once_with("owner@example.com")


def test_owner_verification_promotes_token_and_clears_failure_count(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, _ = members
    result = service.verify_code(
        RequestContext("request", None, owner_id, workspace_id), token="challenge", code="123456"
    )
    assert result == ("owner@example.com", "promoted-token")
    challenges.revoke_token.assert_called_once_with("challenge")
    challenges.reset_verification_failures.assert_called_once_with("owner@example.com")


def test_owner_transfer_commits_roles_before_notification(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    account_domain: AccountDomain,
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, member_id = members

    def notify(notification: WorkspaceOwnerTransferNotification) -> None:
        assert (notification.old_owner_account_id, notification.new_owner_account_id) == (owner_id, member_id)
        assert notification.workspace_name == "Workspace"
        assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.NORMAL
        assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.OWNER

    challenges.notify.side_effect = notify
    service.transfer(RequestContext("request", None, owner_id, workspace_id), member_id=member_id, token="challenge")
    assert challenges.notify.call_count == 2


def test_owner_transfer_recovery_delivers_persisted_notifications_after_local_commit_failure(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, member_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.is_owner.side_effect = lambda _workspace_id, _actor_id, subject_id: subject_id == owner_id
    complete_owner_transfer = account_domain.workspaces.complete_owner_transfer
    complete_calls = 0

    def fail_first_local_commit(transfer: WorkspaceOwnerTransfer) -> bool:
        nonlocal complete_calls
        complete_calls += 1
        if complete_calls == 1:
            raise RuntimeError("Membership commit failed")
        return complete_owner_transfer(transfer)

    monkeypatch.setattr(account_domain.workspaces, "complete_owner_transfer", fail_first_local_commit)

    with pytest.raises(RuntimeError, match="Membership commit failed"):
        service.transfer(
            RequestContext("request", None, owner_id, workspace_id),
            member_id=member_id,
            token="challenge",
        )

    challenges.revoke_token.assert_called_once_with("challenge")
    challenges.notify.assert_not_called()
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.NORMAL

    recovery_gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    recovery = WorkspaceOwnerTransferRecoveryService(
        workspaces=account_domain.workspaces,
        access=account_domain.access,
        notifications=WorkspaceOwnerTransferNotificationService(
            workspaces=account_domain.workspaces,
            gateway=recovery_gateway,
        ),
    )

    assert recovery.recover() == 1
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.NORMAL
    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.OWNER
    assert recovery_gateway.notify.call_count == 2
    delivered = [call.args[0] for call in recovery_gateway.notify.call_args_list]
    assert {item.recipient_type for item in delivered} == {"old_owner", "new_owner"}
    assert {(item.old_owner_account_id, item.new_owner_account_id) for item in delivered} == {(owner_id, member_id)}

    recovery_gateway.reset_mock()
    assert recovery.recover() == 0
    recovery_gateway.notify.assert_not_called()


def test_owner_transfer_notification_failure_retries_only_the_failed_recipient(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, member_id = members
    attempted_recipients: list[str] = []

    def fail_old_owner_once(notification: WorkspaceOwnerTransferNotification) -> None:
        attempted_recipients.append(notification.recipient_type)
        if notification.recipient_type == "old_owner":
            raise RuntimeError("Mail queue unavailable")

    challenges.notify.side_effect = fail_old_owner_once
    with pytest.raises(RuntimeError, match="Mail queue unavailable"):
        service.transfer(
            RequestContext("request", None, owner_id, workspace_id),
            member_id=member_id,
            token="challenge",
        )

    assert sorted(attempted_recipients) == ["new_owner", "old_owner"]
    with sqlite_session_factory.begin() as session:
        rows = tuple(
            session.scalars(
                select(WorkspaceOwnerTransferNotificationModel).order_by(
                    WorkspaceOwnerTransferNotificationModel.recipient_type
                )
            )
        )
        assert {row.recipient_type: row.status for row in rows} == {
            "new_owner": "sent",
            "old_owner": "pending",
        }
        session.execute(
            update(WorkspaceOwnerTransferNotificationModel)
            .where(WorkspaceOwnerTransferNotificationModel.recipient_type == "old_owner")
            .values(next_attempt_at=naive_utc_now() - timedelta(seconds=1))
        )

    recovery_gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    recovery = WorkspaceOwnerTransferRecoveryService(
        workspaces=account_domain.workspaces,
        access=account_domain.access,
        notifications=WorkspaceOwnerTransferNotificationService(
            workspaces=account_domain.workspaces,
            gateway=recovery_gateway,
        ),
    )
    assert recovery.recover() == 0
    recovered_notification = recovery_gateway.notify.call_args.args[0]
    assert recovered_notification.recipient_type == "old_owner"

    recovery_gateway.reset_mock()
    assert recovery.recover() == 0
    recovery_gateway.notify.assert_not_called()


def test_expired_owner_transfer_notification_claim_is_recovered_once(
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, owner_id, member_id = members
    transfer = account_domain.members.transfer_owner(
        workspace_id,
        member_id,
        owner_id,
        notification=WorkspaceOwnerTransferNotificationDetails(
            old_owner_email="owner@example.com",
            old_owner_language="en-US",
            new_owner_email="member@example.com",
            new_owner_language="en-US",
            workspace_name="Workspace",
        ),
    )
    notifications = account_domain.workspaces.list_pending_owner_transfer_notifications(
        operation_id=transfer.operation_id
    )
    abandoned = account_domain.workspaces.claim_owner_transfer_notification(notifications[0])
    assert abandoned is not None
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(WorkspaceOwnerTransferNotificationModel)
            .where(WorkspaceOwnerTransferNotificationModel.notification_id == abandoned.notification_id)
            .values(lease_expires_at=naive_utc_now() - timedelta(seconds=1))
        )

    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    delivery = WorkspaceOwnerTransferNotificationService(workspaces=account_domain.workspaces, gateway=gateway)
    assert delivery.recover() == 2
    assert gateway.notify.call_count == 2

    gateway.reset_mock()
    assert delivery.recover() == 0
    gateway.notify.assert_not_called()


def test_owner_transfer_notification_is_reenqueued_with_same_identity_after_ack_commit_failure(
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, owner_id, member_id = members
    transfer = account_domain.members.transfer_owner(
        workspace_id,
        member_id,
        owner_id,
        notification=WorkspaceOwnerTransferNotificationDetails(
            old_owner_email="owner@example.com",
            old_owner_language="en-US",
            new_owner_email="member@example.com",
            new_owner_language="en-US",
            workspace_name="Workspace",
        ),
    )
    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    fail_next_commit = False
    first_enqueued: WorkspaceOwnerTransferNotification | None = None

    def arm_ack_commit_failure(notification: WorkspaceOwnerTransferNotification) -> None:
        nonlocal fail_next_commit, first_enqueued
        if first_enqueued is None:
            first_enqueued = notification
            fail_next_commit = True

    def fail_armed_commit(_connection: object) -> None:
        nonlocal fail_next_commit
        if fail_next_commit:
            fail_next_commit = False
            raise RuntimeError("notification ack commit failed")

    gateway.notify.side_effect = arm_ack_commit_failure
    engine = sqlite_session_factory.kw["bind"]
    event.listen(engine, "commit", fail_armed_commit)
    try:
        with pytest.raises(RuntimeError, match="notification ack commit failed"):
            WorkspaceOwnerTransferNotificationService(
                workspaces=account_domain.workspaces,
                gateway=gateway,
            ).deliver_operation(transfer.operation_id)
    finally:
        event.remove(engine, "commit", fail_armed_commit)

    assert first_enqueued is not None
    with sqlite_session_factory.begin() as session:
        persisted = session.get_one(WorkspaceOwnerTransferNotificationModel, first_enqueued.notification_id)
        assert persisted.status == "pending"
        assert persisted.claim_id == first_enqueued.claim_id
        assert session.get(WorkspaceOwnerTransferOperation, workspace_id) is not None
        persisted.lease_expires_at = naive_utc_now() - timedelta(seconds=1)

    fresh_repository = WorkspaceRepository(sqlite_session_factory)
    retry_gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    assert (
        WorkspaceOwnerTransferNotificationService(
            workspaces=fresh_repository,
            gateway=retry_gateway,
        ).recover()
        == 2
    )
    retried = [
        call.args[0]
        for call in retry_gateway.notify.call_args_list
        if call.args[0].notification_id == first_enqueued.notification_id
    ]
    assert len(retried) == 1
    assert retried[0].operation_id == first_enqueued.operation_id
    assert retried[0].recipient_type == first_enqueued.recipient_type


def test_next_owner_transfer_preserves_pending_notifications_from_the_previous_operation(
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, first_owner_id, second_owner_id = members
    with sqlite_session_factory.begin() as session:
        third_owner = Account(name="Third owner", email="third-owner@example.com", interface_language="zh-Hans")
        session.add(third_owner)
        session.flush()
        third_owner_id = third_owner.id
        session.add(
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=third_owner_id,
                role=TenantAccountRole.NORMAL,
            )
        )

    first_transfer = account_domain.members.transfer_owner(
        workspace_id,
        second_owner_id,
        first_owner_id,
        notification=WorkspaceOwnerTransferNotificationDetails(
            old_owner_email="owner@example.com",
            old_owner_language="en-US",
            new_owner_email="member@example.com",
            new_owner_language="en-US",
            workspace_name="Workspace before rename",
        ),
    )
    second_transfer = account_domain.members.transfer_owner(
        workspace_id,
        third_owner_id,
        second_owner_id,
        notification=WorkspaceOwnerTransferNotificationDetails(
            old_owner_email="member@example.com",
            old_owner_language="en-US",
            new_owner_email="third-owner@example.com",
            new_owner_language="zh-Hans",
            workspace_name="Workspace after rename",
        ),
    )

    assert first_transfer.operation_id != second_transfer.operation_id
    with sqlite_session_factory() as session:
        rows = tuple(session.scalars(select(WorkspaceOwnerTransferNotificationModel)))
    assert len(rows) == 4
    payloads = {
        (row.operation_id, row.recipient_type): (
            row.old_owner_account_id,
            row.new_owner_account_id,
            row.recipient_email,
            row.recipient_language,
            row.workspace_name,
            row.new_owner_email,
            row.status,
        )
        for row in rows
    }
    assert payloads[(first_transfer.operation_id, "old_owner")] == (
        first_owner_id,
        second_owner_id,
        "owner@example.com",
        "en-US",
        "Workspace before rename",
        "member@example.com",
        "pending",
    )
    assert payloads[(first_transfer.operation_id, "new_owner")][2:] == (
        "member@example.com",
        "en-US",
        "Workspace before rename",
        "member@example.com",
        "pending",
    )
    assert payloads[(second_transfer.operation_id, "old_owner")] == (
        second_owner_id,
        third_owner_id,
        "member@example.com",
        "en-US",
        "Workspace after rename",
        "third-owner@example.com",
        "pending",
    )
    assert payloads[(second_transfer.operation_id, "new_owner")][2:] == (
        "third-owner@example.com",
        "zh-Hans",
        "Workspace after rename",
        "third-owner@example.com",
        "pending",
    )

    fresh_repository = WorkspaceRepository(sqlite_session_factory)
    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    delivery = WorkspaceOwnerTransferNotificationService(workspaces=fresh_repository, gateway=gateway)
    assert delivery.recover() == 4
    delivered = [call.args[0] for call in gateway.notify.call_args_list]
    assert {(item.operation_id, item.recipient_type) for item in delivered} == {
        (first_transfer.operation_id, "old_owner"),
        (first_transfer.operation_id, "new_owner"),
        (second_transfer.operation_id, "old_owner"),
        (second_transfer.operation_id, "new_owner"),
    }

    gateway.reset_mock()
    assert delivery.recover() == 0
    gateway.notify.assert_not_called()


def test_owner_transfer_rejects_accounts_outside_workspace(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    account_domain: AccountDomain,
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, _ = members
    outside = account_domain.accounts.create_account("outside@example.com", "Outside", "en-US")
    with pytest.raises(MemberNotInTenantError):
        service.transfer(
            RequestContext("request", None, owner_id, workspace_id), member_id=outside.id, token="challenge"
        )
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    challenges.notify.assert_not_called()


@pytest.mark.parametrize("operation", ["send_code", "transfer"])
def test_owner_transfer_reports_missing_workspace(
    owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
    members: tuple[str, str, str],
    account_domain: AccountDomain,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    service, challenges = owner_transfer
    workspace_id, owner_id, member_id = members
    monkeypatch.setattr(account_domain.workspaces, "get", lambda _workspace_id: None)
    context = RequestContext("request", None, owner_id, workspace_id)
    if operation == "send_code":
        with pytest.raises(WorkspaceNotFoundError):
            service.send_code(context, ip_address="127.0.0.1", language=None)
    else:
        with pytest.raises(WorkspaceNotFoundError):
            service.transfer(context, member_id=member_id, token="challenge")
    challenges.send_confirmation.assert_not_called()
    challenges.notify.assert_not_called()
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER


def test_rbac_transfer_failure_leaves_local_owner_unchanged(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
) -> None:
    workspace_id, owner_id, member_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.is_owner.side_effect = lambda _workspace_id, _actor_id, member_id: member_id == owner_id
    account_domain.access.reconcile_owner.side_effect = RuntimeError("RBAC unavailable")
    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.NORMAL
    assert account_domain.workspaces.get_pending_owner_transfer(workspace_id) is not None


def test_matching_pending_owner_transfer_retry_bypasses_drifted_rbac_permissions(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id, owner_id, member_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.permission_keys.return_value = {"workspace.role.manage"}
    account_domain.access.is_owner.side_effect = lambda _workspace_id, _actor_id, subject_id: subject_id == owner_id
    complete_owner_transfer = account_domain.workspaces.complete_owner_transfer
    complete_calls = 0

    def fail_first_local_commit(transfer: WorkspaceOwnerTransfer) -> bool:
        nonlocal complete_calls
        complete_calls += 1
        if complete_calls == 1:
            raise RuntimeError("Membership commit failed")
        return complete_owner_transfer(transfer)

    monkeypatch.setattr(account_domain.workspaces, "complete_owner_transfer", fail_first_local_commit)
    with pytest.raises(RuntimeError, match="Membership commit failed"):
        account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)

    account_domain.access.permission_keys.return_value = set()
    account_domain.access.is_owner.return_value = False
    account_domain.access.is_owner.side_effect = None
    account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)

    assert account_domain.access.reconcile_owner.call_args_list[0].kwargs == {"actor_id": owner_id}
    assert account_domain.access.reconcile_owner.call_args_list[1].kwargs == {"actor_id": None}
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.NORMAL
    assert account_domain.members.get_role(workspace_id, member_id) == TenantAccountRole.OWNER
    assert account_domain.workspaces.get_pending_owner_transfer(workspace_id) is None


@dataclass(frozen=True)
class RoleAssignment:
    tenant_id: str
    account_id: str | None
    member_account_id: str
    role_ids: list[str]


@dataclass
class RecordedRoleAssignments:
    calls: list[RoleAssignment] = field(default_factory=list)
    failure: Exception | None = None
    on_apply: Callable[..., None] | None = None

    def __call__(
        self, *, tenant_id: str, account_id: str | None, member_account_id: str, role_ids: list[str]
    ) -> MemberRolesResponse:
        self.calls.append(RoleAssignment(tenant_id, account_id, member_account_id, list(role_ids)))
        if self.failure:
            raise self.failure
        if self.on_apply:
            self.on_apply(
                tenant_id=tenant_id, account_id=account_id, member_account_id=member_account_id, role_ids=role_ids
            )
        return MemberRolesResponse(account_id=member_account_id)


@pytest.fixture
def rbac_access(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    members: tuple[str, str, str],
) -> tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments]:
    config_overrides(RBAC_ENABLED=True, DATASET_OPERATOR_ENABLED=True)
    gateway = DeploymentWorkspaceMemberAccessGateway()
    roles = [
        RBACRole(id=f"role-{tag}", name=tag, type="", category="global_system_default", role_tag=tag, is_builtin=True)
        for tag in [*(role.value for role in TenantAccountRole), "no_access"]
    ]
    _, owner_id, _ = members
    roles_by_tag = {role.role_tag: role for role in roles}

    def get_roles(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
        del tenant_id, account_id
        tag = "owner" if member_account_id == owner_id else "normal"
        return MemberRolesResponse(account_id=member_account_id, roles=[roles_by_tag[tag]])

    monkeypatch.setattr(RBACService.Roles, "list", lambda *_args, **_kwargs: Paginated[RBACRole](data=roles))
    monkeypatch.setattr(RBACService.MemberRoles, "get", get_roles)
    monkeypatch.setattr(gateway, "permission_keys", lambda _workspace_id, _actor_id: {"workspace.role.manage"})
    replace = RecordedRoleAssignments()
    monkeypatch.setattr(RBACService.MemberRoles, "replace", replace)
    return gateway, replace


@pytest.mark.parametrize(
    ("status", "already_joined"),
    [
        (None, False),
        (AccountStatus.PENDING, False),
        (AccountStatus.PENDING, True),
        (AccountStatus.ACTIVE, False),
        (AccountStatus.ACTIVE, True),
    ],
    ids=["new-account", "pending-account", "pending-member", "active-account", "active-member"],
)
def test_rbac_invitation_assigns_requested_role(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    monkeypatch: pytest.MonkeyPatch,
    status: AccountStatus | None,
    already_joined: bool,
) -> None:
    from tasks.initialize_created_app_rbac_access_task import sync_joined_workspace_member_rbac_access_task

    workspace_id, owner_id, _ = members
    email = "invited@example.com"
    if status is not None:
        account = Account(name="Invited", email=email, status=status)
        sqlite_session.add(account)
        if already_joined:
            sqlite_session.add(
                TenantAccountJoin(tenant_id=workspace_id, account_id=account.id, role=TenantAccountRole.NORMAL)
            )
        sqlite_session.commit()
    access, replace = rbac_access
    monkeypatch.setattr(access, "permission_keys", lambda _workspace, _actor: {"workspace.member.manage"})
    synced_members: list[tuple[str, str, str | None]] = []

    def sync(tenant_id: str, member_account_id: str, operator_account_id: str | None = None) -> None:
        synced_members.append((tenant_id, member_account_id, operator_account_id))

    monkeypatch.setattr(sync_joined_workspace_member_rbac_access_task, "delay", sync)
    member_service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=access,
        quotas=account_domain.member_quotas,
    )
    invitations = WorkspaceInvitationService(
        accounts=account_domain.accounts,
        workspaces=account_domain.workspaces,
        members=member_service,
        invitations=account_domain.delivery,
    )
    account_domain.delivery.acquire.return_value = nullcontext()

    results = invitations.invite_many(
        RequestContext("request", None, owner_id, workspace_id),
        emails=[email],
        language="en-US",
        role="custom-role-id",
    )

    invited = account_domain.repository.find_by_email(email)
    assert invited is not None
    assert member_service.get_role(workspace_id, invited.id) == TenantAccountRole.NORMAL
    if status == AccountStatus.ACTIVE and already_joined:
        assert replace.calls == []
    else:
        assignments = [item for item in replace.calls if item.tenant_id == workspace_id]
        assert len(assignments) == 1
        assert assignments[0].account_id == owner_id
        assert assignments[0].member_account_id == invited.id
        assert assignments[0].role_ids == ["custom-role-id"]
        assert len(replace.calls) == 1
    if status == AccountStatus.ACTIVE:
        assert results[0].status == "already_member"
        account_domain.delivery.create.assert_not_called()
        account_domain.delivery.send.assert_not_called()
    else:
        assert results[0].status == "success"
        assert invited.status == "pending"
        invitation = account_domain.delivery.create.call_args.args[0]
        assert invitation.account_id == invited.id
        assert invitation.role == "custom-role-id"
        assert invitation.requires_setup is True
        account_domain.delivery.send.assert_called_once_with(
            language="en-US", email=email, token="invitation-token", inviter_name="Owner", workspace_name="Workspace"
        )
    assert synced_members == (
        [(workspace_id, invited.id, owner_id)] if status == AccountStatus.ACTIVE and not already_joined else []
    )


@pytest.mark.parametrize(
    "operator_role",
    [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.DATASET_OPERATOR],
)
@pytest.mark.parametrize(
    "new_role",
    [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.DATASET_OPERATOR],
)
def test_rbac_role_managers_cannot_demote_owner(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    operator_role: TenantAccountRole,
    new_role: TenantAccountRole,
) -> None:
    workspace_id, owner_id, operator_id = members
    membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == operator_id))
    assert membership is not None
    membership.role = operator_role
    sqlite_session.commit()
    gateway, replace = rbac_access
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )

    with pytest.raises(NoPermissionError):
        service.update_role(workspace_id, owner_id, new_role.value, operator_id)

    assert replace.calls == []
    assert service.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert service.get_role(workspace_id, operator_id) == operator_role


@pytest.mark.parametrize(
    "operator_role",
    [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.DATASET_OPERATOR],
)
def test_rbac_role_managers_cannot_transfer_ownership(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    operator_role: TenantAccountRole,
) -> None:
    workspace_id, owner_id, operator_id = members
    membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == operator_id))
    assert membership is not None
    membership.role = operator_role
    target = Account(name="Target", email="target@example.com")
    sqlite_session.add_all(
        [target, TenantAccountJoin(tenant_id=workspace_id, account_id=target.id, role=TenantAccountRole.NORMAL)]
    )
    sqlite_session.commit()
    account_domain.access.rbac_enabled = True
    account_domain.access.permission_keys.return_value = {"workspace.role.manage"}

    with pytest.raises(NoPermissionError):
        account_domain.members.update_role(workspace_id, target.id, "owner", operator_id)

    account_domain.access.transfer_owner.assert_not_called()
    account_domain.access.change_role.assert_not_called()
    assert account_domain.members.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert account_domain.members.get_role(workspace_id, target.id) == TenantAccountRole.NORMAL


def test_rbac_normal_role_manager_can_update_another_non_owner(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
) -> None:
    workspace_id, owner_id, operator_id = members
    target = Account(name="Target", email="target@example.com")
    sqlite_session.add_all(
        [target, TenantAccountJoin(tenant_id=workspace_id, account_id=target.id, role=TenantAccountRole.NORMAL)]
    )
    sqlite_session.commit()
    gateway, replace = rbac_access
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )

    service.update_role(workspace_id, target.id, "editor", operator_id)

    assert len(replace.calls) == 1
    assert replace.calls[0].member_account_id == target.id
    assert replace.calls[0].role_ids == ["role-editor"]
    assert service.get_role(workspace_id, target.id) == TenantAccountRole.EDITOR
    assert service.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER


@pytest.mark.parametrize(
    "role",
    [TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR],
)
@pytest.mark.parametrize("remote_fails", [False, True])
def test_rbac_role_update_assigns_requested_role_and_synchronizes_membership(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    role: TenantAccountRole,
    remote_fails: bool,
) -> None:
    workspace_id, owner_id, member_id = members
    previous = TenantAccountRole.EDITOR if role == TenantAccountRole.NORMAL else TenantAccountRole.NORMAL
    membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == member_id))
    assert membership is not None
    membership.role = previous
    sqlite_session.commit()
    gateway, replace = rbac_access
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )
    if remote_fails:
        replace.failure = RuntimeError("RBAC unavailable")
        with pytest.raises(RuntimeError, match="RBAC unavailable"):
            service.update_role(workspace_id, member_id, role.value, owner_id)
    else:
        service.update_role(workspace_id, member_id, role.value, owner_id)

    assert len(replace.calls) == 1
    assert replace.calls[0].role_ids == [f"role-{role.value}"]
    assert replace.calls[0].member_account_id == member_id
    assert service.get_role(workspace_id, member_id) == (previous if remote_fails else role)
    assert service.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER


def test_rbac_owner_transfer_preserves_other_roles_and_updates_both_memberships(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id, owner_id, member_id = members
    gateway, replace = rbac_access
    monkeypatch.setattr(gateway, "owner_id", lambda _workspace_id, _actor_id: owner_id)
    current_roles = MemberRolesResponse(
        account_id=owner_id,
        roles=[
            RBACRole(
                id="role-owner",
                name="Owner",
                type="",
                category="global_system_default",
                role_tag="owner",
                is_builtin=True,
            ),
            RBACRole(id="custom", name="Custom", type=""),
        ],
    )

    def get_roles(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
        del tenant_id, account_id
        return current_roles if member_account_id == owner_id else MemberRolesResponse(account_id=member_account_id)

    monkeypatch.setattr(RBACService.MemberRoles, "get", get_roles)
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )

    service.update_role(workspace_id, member_id, "owner", owner_id)

    assert [(call.member_account_id, call.role_ids) for call in replace.calls] == [
        (owner_id, ["custom"]),
        (member_id, ["role-owner"]),
    ]
    assert service.get_role(workspace_id, owner_id) == TenantAccountRole.NORMAL
    assert service.get_role(workspace_id, member_id) == TenantAccountRole.OWNER


def test_rbac_owner_reconciliation_skips_writes_when_remote_state_matches(
    members: tuple[str, str, str],
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id, old_owner_id, new_owner_id = members
    gateway, replace = rbac_access
    normal_role = RBACRole(
        id="role-normal",
        name="Normal",
        type="",
        category="global_system_default",
        role_tag="normal",
        is_builtin=True,
    )
    owner_role = RBACRole(
        id="role-owner",
        name="Owner",
        type="",
        category="global_system_default",
        role_tag="owner",
        is_builtin=True,
    )

    def get_roles(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
        del tenant_id, account_id
        roles = [owner_role] if member_account_id == new_owner_id else [normal_role]
        return MemberRolesResponse(account_id=member_account_id, roles=roles)

    monkeypatch.setattr(RBACService.MemberRoles, "get", get_roles)

    gateway.reconcile_owner(workspace_id, old_owner_id, new_owner_id, actor_id=None)

    assert replace.calls == []


def test_rbac_owner_transfer_recovery_converges_after_local_commit_failure(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session: Session,
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id, old_owner_id, new_owner_id = members
    third_member = Account(name="Third", email="third@example.com")
    sqlite_session.add_all(
        [
            third_member,
            TenantAccountJoin(tenant_id=workspace_id, account_id=third_member.id, role=TenantAccountRole.NORMAL),
        ]
    )
    sqlite_session.commit()
    gateway, replace = rbac_access
    owner_role = RBACRole(
        id="role-owner", name="Owner", type="", category="global_system_default", role_tag="owner", is_builtin=True
    )
    custom_role = RBACRole(id="custom-manager", name="Role manager", type="")
    remote_roles = {old_owner_id: [owner_role, custom_role], new_owner_id: [], third_member.id: []}
    roles_by_id = {role.id: role for role in [owner_role, custom_role]}

    def get_roles(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
        del tenant_id, account_id
        return MemberRolesResponse(account_id=member_account_id, roles=remote_roles[member_account_id])

    def replace_roles(*, tenant_id: str, account_id: str | None, member_account_id: str, role_ids: list[str]) -> None:
        del tenant_id, account_id
        remote_roles[member_account_id] = [
            roles_by_id.get(role_id, RBACRole(id=role_id, name=role_id, type="")) for role_id in role_ids
        ]

    monkeypatch.setattr(RBACService.MemberRoles, "get", get_roles)
    monkeypatch.setattr(
        gateway,
        "owner_id",
        lambda _workspace_id, _actor_id: next(
            member_id for member_id, roles in remote_roles.items() if owner_role in roles
        ),
    )
    replace.on_apply = replace_roles
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )
    complete_owner_transfer = account_domain.workspaces.complete_owner_transfer
    complete_calls = 0

    def fail_first_local_commit(transfer: WorkspaceOwnerTransfer) -> bool:
        nonlocal complete_calls
        complete_calls += 1
        if complete_calls == 1:
            raise RuntimeError("Membership commit failed")
        return complete_owner_transfer(transfer)

    monkeypatch.setattr(account_domain.workspaces, "complete_owner_transfer", fail_first_local_commit)
    with pytest.raises(RuntimeError, match="Membership commit failed"):
        service.update_role(workspace_id, new_owner_id, "owner", old_owner_id)

    assert remote_roles[old_owner_id] == [custom_role]
    assert remote_roles[new_owner_id] == [owner_role]
    assert service.get_role(workspace_id, old_owner_id) == TenantAccountRole.OWNER
    assert service.get_role(workspace_id, new_owner_id) == TenantAccountRole.NORMAL
    assert account_domain.workspaces.get_pending_owner_transfer(workspace_id) is not None

    recovered = WorkspaceOwnerTransferRecoveryService(
        workspaces=account_domain.workspaces,
        access=gateway,
        notifications=_notification_service(account_domain),
    ).recover()

    assert recovered == 1
    assert remote_roles[old_owner_id] == [custom_role]
    assert remote_roles[new_owner_id] == [owner_role]
    assert remote_roles[third_member.id] == []
    assert service.get_role(workspace_id, old_owner_id) == TenantAccountRole.NORMAL
    assert service.get_role(workspace_id, new_owner_id) == TenantAccountRole.OWNER
    assert service.get_role(workspace_id, third_member.id) == TenantAccountRole.NORMAL
    assert account_domain.workspaces.get_pending_owner_transfer(workspace_id) is None


def test_owner_transfer_watch_repairs_a_late_expired_execution_after_a_new_transfer(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    workspace_id, first_owner_id, second_owner_id = members
    with sqlite_session_factory.begin() as session:
        third_owner = Account(name="Third owner", email="third-owner@example.com")
        session.add(third_owner)
        session.flush()
        third_owner_id = third_owner.id
        session.add(
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=third_owner_id,
                role=TenantAccountRole.NORMAL,
            )
        )

    access = DeploymentWorkspaceMemberAccessGateway()
    remote_owners = {first_owner_id}
    remote_lock = Lock()
    late_started = Event()
    release_late = Event()

    monkeypatch.setattr(access, "permission_keys", lambda _workspace_id, _actor_id: {"workspace.role.manage"})

    def is_owner(_workspace_id: str, _actor_id: str, member_id: str) -> bool:
        with remote_lock:
            return member_id in remote_owners

    def reconcile_owner(
        _workspace_id: str,
        old_owner_id: str,
        new_owner_id: str,
        *,
        actor_id: str | None,
    ) -> None:
        del actor_id
        if current_thread().name.startswith("late-owner-transfer"):
            late_started.set()
            assert release_late.wait(timeout=10)
        with remote_lock:
            remote_owners.discard(old_owner_id)
            remote_owners.add(new_owner_id)

    monkeypatch.setattr(access, "is_owner", is_owner)
    monkeypatch.setattr(access, "reconcile_owner", reconcile_owner)
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=access,
        quotas=account_domain.member_quotas,
    )
    recovery = WorkspaceOwnerTransferRecoveryService(
        workspaces=account_domain.workspaces,
        access=access,
        notifications=_notification_service(account_domain),
    )

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="late-owner-transfer") as executor:
        late = executor.submit(
            service.update_role,
            workspace_id,
            second_owner_id,
            TenantAccountRole.OWNER.value,
            first_owner_id,
        )
        assert late_started.wait(timeout=10)

        with pytest.raises(WorkspaceOwnerTransferInProgressError):
            service.update_role(
                workspace_id,
                second_owner_id,
                TenantAccountRole.OWNER.value,
                first_owner_id,
            )

        with sqlite_session_factory.begin() as session:
            operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
            operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)

        assert recovery.recover() == 1
        assert service.get_role(workspace_id, second_owner_id) == TenantAccountRole.OWNER
        with remote_lock:
            assert remote_owners == {second_owner_id}

        service.update_role(
            workspace_id,
            third_owner_id,
            TenantAccountRole.OWNER.value,
            second_owner_id,
        )
        assert service.get_role(workspace_id, third_owner_id) == TenantAccountRole.OWNER
        with remote_lock:
            assert remote_owners == {third_owner_id}

        release_late.set()
        with pytest.raises(RuntimeError, match="no longer pending"):
            late.result(timeout=10)

    with remote_lock:
        assert remote_owners == {second_owner_id, third_owner_id}
    with sqlite_session_factory.begin() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        assert operation.status == "watch"
        assert operation.new_owner_account_id == third_owner_id
        assert set(operation.possible_owner_account_ids) == {
            first_owner_id,
            second_owner_id,
            third_owner_id,
        }
        operation.next_reconcile_at = naive_utc_now() - timedelta(seconds=1)

    assert recovery.recover() == 1
    with remote_lock:
        assert remote_owners == {third_owner_id}
    assert service.get_role(workspace_id, third_owner_id) == TenantAccountRole.OWNER


def test_owner_transfer_watch_is_consumed_without_remote_write_after_workspace_deletion(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, owner_id, member_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.is_owner.side_effect = lambda _workspace, _actor, subject: subject == owner_id

    account_domain.members.update_role(workspace_id, member_id, TenantAccountRole.OWNER.value, owner_id)
    remote_calls = account_domain.access.reconcile_owner.call_count

    with sqlite_session_factory.begin() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        operation.next_reconcile_at = naive_utc_now() - timedelta(seconds=1)
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace_id))
        session.execute(delete(Tenant).where(Tenant.id == workspace_id))

    assert (
        WorkspaceOwnerTransferRecoveryService(
            workspaces=account_domain.workspaces,
            access=account_domain.access,
            notifications=_notification_service(account_domain),
        ).recover()
        == 0
    )
    assert account_domain.access.reconcile_owner.call_count == remote_calls
    with sqlite_session_factory() as session:
        assert session.get(WorkspaceOwnerTransferOperation, workspace_id) is None


def test_invalidated_pending_transfer_becomes_a_watch_for_the_current_local_owner(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, old_owner_id, removed_target_id = members
    transfer = account_domain.workspaces.prepare_owner_transfer(
        workspace_id=workspace_id,
        actor_account_id=old_owner_id,
        account_id=removed_target_id,
    )
    stale_claim = account_domain.workspaces.claim_owner_transfer_execution(transfer)
    assert stale_claim is not None

    with sqlite_session_factory.begin() as session:
        current_owner = Account(name="Current owner", email="replacement-owner@example.com")
        session.add(current_owner)
        session.flush()
        current_owner_id = current_owner.id
        session.add(
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=current_owner_id,
                role=TenantAccountRole.OWNER,
            )
        )
        old_owner = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == workspace_id,
                TenantAccountJoin.account_id == old_owner_id,
            )
        )
        assert old_owner is not None
        old_owner.role = TenantAccountRole.NORMAL
        session.execute(
            delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == workspace_id,
                TenantAccountJoin.account_id == removed_target_id,
            )
        )
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)

    repair_claim = account_domain.workspaces.claim_owner_transfer_execution(transfer)

    assert repair_claim is not None
    assert repair_claim.status == "watch"
    assert repair_claim.operation_id != transfer.operation_id
    assert repair_claim.new_owner_account_id == current_owner_id
    assert set(repair_claim.possible_owner_account_ids) == {
        old_owner_id,
        removed_target_id,
        current_owner_id,
    }
    assert account_domain.workspaces.complete_owner_transfer(stale_claim) is False
    assert account_domain.workspaces.complete_owner_transfer(repair_claim) is True
    assert account_domain.members.get_role(workspace_id, removed_target_id) is None
    assert account_domain.members.get_role(workspace_id, current_owner_id) == TenantAccountRole.OWNER


def test_owner_transfer_watch_follows_the_current_local_owner_without_readding_a_removed_member(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, first_owner_id, removed_owner_id = members
    account_domain.access.rbac_enabled = True
    account_domain.access.is_owner.side_effect = lambda _workspace, _actor, subject: subject == first_owner_id
    account_domain.members.update_role(
        workspace_id,
        removed_owner_id,
        TenantAccountRole.OWNER.value,
        first_owner_id,
    )

    with sqlite_session_factory.begin() as session:
        current_owner = Account(name="Current owner", email="current-owner@example.com")
        session.add(current_owner)
        session.flush()
        current_owner_id = current_owner.id
        session.add(
            TenantAccountJoin(
                tenant_id=workspace_id,
                account_id=current_owner_id,
                role=TenantAccountRole.OWNER,
            )
        )
        session.execute(
            delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == workspace_id,
                TenantAccountJoin.account_id == removed_owner_id,
            )
        )
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        operation.next_reconcile_at = naive_utc_now() - timedelta(seconds=1)

    account_domain.access.reconcile_owner.reset_mock()
    assert (
        WorkspaceOwnerTransferRecoveryService(
            workspaces=account_domain.workspaces,
            access=account_domain.access,
            notifications=_notification_service(account_domain),
        ).recover()
        == 1
    )

    assert {(call.args[1], call.args[2]) for call in account_domain.access.reconcile_owner.call_args_list} == {
        (first_owner_id, current_owner_id),
        (removed_owner_id, current_owner_id),
    }
    assert account_domain.members.get_role(workspace_id, removed_owner_id) is None
    assert account_domain.members.get_role(workspace_id, current_owner_id) == TenantAccountRole.OWNER
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        assert operation.new_owner_account_id == current_owner_id
        assert current_owner_id in operation.possible_owner_account_ids


@pytest.mark.parametrize("new_role", ["editor", "owner"])
def test_rbac_owner_lookup_failure_prevents_role_changes(
    account_domain: AccountDomain,
    members: tuple[str, str, str],
    rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    monkeypatch: pytest.MonkeyPatch,
    new_role: str,
) -> None:
    workspace_id, owner_id, member_id = members
    gateway, replace = rbac_access

    def get_roles(tenant_id: str, account_id: str | None, member_account_id: str) -> MemberRolesResponse:
        del tenant_id, account_id
        if new_role == "editor" or member_account_id == owner_id:
            raise RuntimeError("RBAC unavailable")
        return MemberRolesResponse(account_id=member_account_id)

    monkeypatch.setattr(RBACService.MemberRoles, "get", get_roles)
    service = WorkspaceMemberService(
        workspaces=account_domain.workspaces,
        accounts=account_domain.repository,
        access=gateway,
        quotas=account_domain.member_quotas,
    )

    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        service.update_role(workspace_id, member_id, new_role, owner_id)

    assert replace.calls == []
    assert service.get_role(workspace_id, owner_id) == TenantAccountRole.OWNER
    assert service.get_role(workspace_id, member_id) == TenantAccountRole.NORMAL

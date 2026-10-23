from collections.abc import Callable, Mapping, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from enums.account import TenantAccountRole as _workspace_member_query_service_TenantAccountRole
from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from models.account import TenantAccountRole as _member_service_TenantAccountRole
from models.dataset import Dataset
from models.model import App
from services.account.adapters import RedisInvitationTokenStore
from services.account_errors import AccountNotFoundError
from services.enterprise.rbac_service import RBACService
from services.entities.account_entities import AccountSnapshot
from services.entities.feature_entities import FeatureModel, LicenseLimitationModel, LicenseModel
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
)
from services.feature_service import FeatureService
from services.rbac.contracts import MemberRolesResponse, Paginated, RBACRole
from services.system_feature_service import SystemFeatureService
from services.workspace.contracts import (
    OwnerTransferToken,
    WorkspaceMemberRecord,
    WorkspaceMemberRole,
    WorkspaceMemberRoleSubject,
    WorkspaceMemberSummary,
)
from services.workspace.gateways import (
    DeploymentWorkspaceMemberAccessGateway,
    WorkspaceInvitationGateway,
)
from services.workspace.member_service import (
    OwnerTransferGateway,
    WorkspaceInvitationService,
    WorkspaceMemberQueryService,
    WorkspaceMemberService,
    WorkspaceOwnerTransferService,
)
from tests.helpers.unit.account_domain import AccountDomain

"""Membership and invitation behavior across the application/persistence boundary."""


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


class TestMemberServiceCases:
    @staticmethod
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
                TenantAccountJoin(
                    account_id=owner.id, tenant_id=tenant.id, role=_member_service_TenantAccountRole.OWNER, current=True
                ),
                TenantAccountJoin(
                    account_id=member.id, tenant_id=tenant.id, role=_member_service_TenantAccountRole.NORMAL
                ),
            ]
        )
        sqlite_session.commit()
        return tenant.id, owner.id, member.id

    @staticmethod
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
                role=_member_service_TenantAccountRole.OWNER,
                operator_account_id=owner_id,
            )

        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        assert account_domain.members.get_role(workspace_id, account.id) == (
            _member_service_TenantAccountRole.NORMAL if existing_member else None
        )
        account_domain.access.membership_changed.assert_not_called()

    @staticmethod
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
                [
                    tenant,
                    TenantAccountJoin(
                        account_id=member_id, tenant_id=tenant.id, role=_member_service_TenantAccountRole.NORMAL
                    ),
                ]
            )
        sqlite_session.commit()
        sqlite_session.expunge_all()
        account_domain.members.remove(workspace_id, member_id, owner_id)
        assert (sqlite_session.get(Account, member_id) is None) == deleted
        assert account_domain.members.get_role(workspace_id, member_id) is None
        account_domain.access.member_removed.assert_called_once()
        assert account_domain.access.member_removed.call_args.args[1].account_deleted == deleted

    @staticmethod
    @pytest.mark.parametrize("action", ["add", "remove", "update"])
    def test_self_operations_and_non_administrators_are_denied(
        account_domain: AccountDomain, members: tuple[str, str, str], action: str
    ) -> None:
        workspace_id, owner_id, member_id = members
        with pytest.raises(CannotOperateSelfError):
            account_domain.members.check_permission(workspace_id, owner_id, owner_id, action)
        with pytest.raises(NoPermissionError):
            account_domain.members.check_permission(workspace_id, member_id, owner_id, action)

    @staticmethod
    def test_owner_transfer_demotes_previous_owner(
        account_domain: AccountDomain, members: tuple[str, str, str]
    ) -> None:
        workspace_id, owner_id, member_id = members
        account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)
        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.NORMAL
        assert account_domain.members.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.OWNER

    @staticmethod
    @pytest.mark.parametrize("new_role", ["normal", "owner"])
    def test_admin_cannot_change_owner_or_promote_owner(
        account_domain: AccountDomain, members: tuple[str, str, str], sqlite_session: Session, new_role: str
    ) -> None:
        workspace_id, owner_id, member_id = members
        membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == member_id))
        assert membership is not None
        membership.role = _member_service_TenantAccountRole.ADMIN
        sqlite_session.commit()
        with pytest.raises(NoPermissionError):
            account_domain.members.update_role(workspace_id, owner_id, new_role, member_id)

    @staticmethod
    def test_unchanged_role_does_not_sync(account_domain: AccountDomain, members: tuple[str, str, str]) -> None:
        workspace_id, owner_id, member_id = members
        with pytest.raises(RoleAlreadyAssignedError):
            account_domain.members.update_role(workspace_id, member_id, "normal", owner_id)
        account_domain.access.change_role.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize("role", ["invalid", "dataset_operator"])
    def test_role_policy_prevents_persistence_and_rbac_changes(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        config_overrides: Callable[..., None],
        role: str,
    ) -> None:
        config_overrides(DATASET_OPERATOR_ENABLED=False)
        account_domain.access.ensure_role_enabled.side_effect = (
            DeploymentWorkspaceMemberAccessGateway().ensure_role_enabled
        )
        workspace_id, owner_id, member_id = members

        with pytest.raises(InvalidWorkspaceMemberRoleError):
            account_domain.members.update_role(workspace_id, member_id, role, owner_id)

        assert account_domain.members.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.NORMAL
        account_domain.access.change_role.assert_not_called()

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_new_invitation_normalizes_email_and_sets_current_workspace(
        account_domain: AccountDomain, members: tuple[str, str, str]
    ) -> None:
        workspace_id, owner_id, _ = members
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
        assert account_domain.members.get_role(workspace_id, invitee.id) == _member_service_TenantAccountRole.EDITOR
        membership = account_domain.workspaces.find_membership(invitee.id, workspace_id)
        assert membership is not None
        assert membership.current
        invitation = account_domain.delivery.create.call_args.args[0]
        assert invitation.requires_setup is True
        assert invitation.email == "new@example.com"

    @staticmethod
    def test_active_invitee_must_accept_before_joining(
        account_domain: AccountDomain, members: tuple[str, str, str]
    ) -> None:
        workspace_id, owner_id, _ = members
        account = account_domain.accounts.create_account("new@example.com", "New", "en-US")
        account_domain.invitations.invite(RequestContext("request", None, owner_id, workspace_id), account.email, None)
        assert account_domain.members.get_role(workspace_id, account.id) is None
        assert account_domain.delivery.create.call_args.args[0].requires_setup is False

    @staticmethod
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

    @staticmethod
    def test_active_member_is_reported_without_sending_invitation(
        account_domain: AccountDomain, members: tuple[str, str, str]
    ) -> None:
        workspace_id, owner_id, _ = members
        with pytest.raises(AccountAlreadyInTenantError):
            account_domain.invitations.invite(
                RequestContext("request", None, owner_id, workspace_id), "member@example.com", None
            )
        account_domain.delivery.send.assert_not_called()

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_bulk_invitation_counts_new_accounts_and_members_before_writing(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
        monkeypatch.setattr(FeatureService, "get_features", Mock(return_value=FeatureModel()))
        monkeypatch.setattr(
            SystemFeatureService,
            "get_license",
            Mock(return_value=LicenseModel(seats=LicenseLimitationModel(enabled=True, size=3, limit=3))),
        )
        redis = create_autospec(RedisClientWrapper, instance=True)
        gateway = WorkspaceInvitationGateway(tokens=RedisInvitationTokenStore(redis=redis), redis=redis)
        workspace_id, owner_id, _ = members
        account_domain.accounts.create_account("outside@example.com", "Outside", "en-US")
        account_domain.delivery.acquire.return_value = nullcontext()
        account_domain.delivery.check_capacity.side_effect = gateway.check_capacity
        account_domain.delivery.requires_capacity_check = True

        with pytest.raises(WorkspaceInvitationQuotaError) as error:
            account_domain.invitations.invite_many(
                RequestContext("request", None, owner_id, workspace_id),
                emails=["new@example.com", "outside@example.com", "member@example.com"],
                language=None,
                role="normal",
            )

        assert error.value.seats is True
        account_domain.delivery.check_capacity.assert_called_once_with(
            workspace_id, current_members=2, new_members=2, new_accounts=1
        )
        assert account_domain.repository.find_by_email("new@example.com") is None
        account_domain.delivery.create.assert_not_called()

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_owner_transfer_commits_roles_before_notification(
        owner_transfer: tuple[WorkspaceOwnerTransferService, Mock],
        members: tuple[str, str, str],
        account_domain: AccountDomain,
    ) -> None:
        service, challenges = owner_transfer
        workspace_id, owner_id, member_id = members

        def notify(*, old_owner: AccountSnapshot, new_owner: AccountSnapshot, workspace_name: str) -> None:
            assert (old_owner.id, new_owner.id, workspace_name) == (owner_id, member_id, "Workspace")
            assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.NORMAL
            assert account_domain.members.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.OWNER

        challenges.notify.side_effect = notify
        service.transfer(
            RequestContext("request", None, owner_id, workspace_id), member_id=member_id, token="challenge"
        )
        challenges.notify.assert_called_once()

    @staticmethod
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
        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        challenges.notify.assert_not_called()

    @staticmethod
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
        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER

    @staticmethod
    def test_rbac_transfer_failure_leaves_local_owner_unchanged(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
    ) -> None:
        workspace_id, owner_id, member_id = members
        account_domain.access.rbac_enabled = True
        account_domain.access.is_owner.side_effect = lambda _workspace_id, _actor_id, member_id: member_id == owner_id
        account_domain.access.transfer_owner.side_effect = RuntimeError("RBAC unavailable")
        with pytest.raises(RuntimeError, match="RBAC unavailable"):
            account_domain.members.update_role(workspace_id, member_id, "owner", owner_id)
        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        assert account_domain.members.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.NORMAL

    @staticmethod
    @pytest.fixture
    def rbac_access(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        members: tuple[str, str, str],
    ) -> tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments]:
        config_overrides(RBAC_ENABLED=True, DATASET_OPERATOR_ENABLED=True)
        gateway = DeploymentWorkspaceMemberAccessGateway()
        roles = [
            RBACRole(
                id=f"role-{tag}", name=tag, type="", category="global_system_default", role_tag=tag, is_builtin=True
            )
            for tag in [*(role.value for role in _member_service_TenantAccountRole), "no_access"]
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

    @staticmethod
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
                    TenantAccountJoin(
                        tenant_id=workspace_id, account_id=account.id, role=_member_service_TenantAccountRole.NORMAL
                    )
                )
            sqlite_session.commit()
        access, replace = rbac_access
        monkeypatch.setattr(access, "permission_keys", lambda _workspace, _actor: {"workspace.member.manage"})
        synced_members: list[tuple[str, str, str | None]] = []

        def sync(tenant_id: str, member_account_id: str, operator_account_id: str | None = None) -> None:
            synced_members.append((tenant_id, member_account_id, operator_account_id))

        monkeypatch.setattr(sync_joined_workspace_member_rbac_access_task, "delay", sync)
        member_service = WorkspaceMemberService(
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=access
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
        assert member_service.get_role(workspace_id, invited.id) == _member_service_TenantAccountRole.NORMAL
        if status == AccountStatus.ACTIVE and already_joined:
            assert replace.calls == []
        else:
            assignments = [item for item in replace.calls if item.tenant_id == workspace_id]
            assert len(assignments) == 1
            assert assignments[0].account_id == owner_id
            assert assignments[0].member_account_id == invited.id
            assert assignments[0].role_ids == ["custom-role-id"]
            if status is None:
                # Registration also provisions the invitee's own workspace.
                assert len(replace.calls) == 2
                personal_workspace = replace.calls[0]
                assert personal_workspace.tenant_id != workspace_id
                assert personal_workspace.member_account_id == invited.id
                assert personal_workspace.role_ids == ["role-owner"]
            else:
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
                language="en-US",
                email=email,
                token="invitation-token",
                inviter_name="Owner",
                workspace_name="Workspace",
            )
        assert synced_members == (
            [(workspace_id, invited.id, owner_id)] if status == AccountStatus.ACTIVE and not already_joined else []
        )

    @staticmethod
    @pytest.mark.parametrize(
        "operator_role",
        [
            _member_service_TenantAccountRole.NORMAL,
            _member_service_TenantAccountRole.EDITOR,
            _member_service_TenantAccountRole.ADMIN,
            _member_service_TenantAccountRole.DATASET_OPERATOR,
        ],
    )
    @pytest.mark.parametrize(
        "new_role",
        [
            _member_service_TenantAccountRole.NORMAL,
            _member_service_TenantAccountRole.EDITOR,
            _member_service_TenantAccountRole.ADMIN,
            _member_service_TenantAccountRole.DATASET_OPERATOR,
        ],
    )
    def test_rbac_role_managers_cannot_demote_owner(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        sqlite_session: Session,
        rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
        operator_role: _member_service_TenantAccountRole,
        new_role: _member_service_TenantAccountRole,
    ) -> None:
        workspace_id, owner_id, operator_id = members
        membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == operator_id))
        assert membership is not None
        membership.role = operator_role
        sqlite_session.commit()
        gateway, replace = rbac_access
        service = WorkspaceMemberService(
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
        )

        with pytest.raises(NoPermissionError):
            service.update_role(workspace_id, owner_id, new_role.value, operator_id)

        assert replace.calls == []
        assert service.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        assert service.get_role(workspace_id, operator_id) == operator_role

    @staticmethod
    @pytest.mark.parametrize(
        "operator_role",
        [
            _member_service_TenantAccountRole.NORMAL,
            _member_service_TenantAccountRole.EDITOR,
            _member_service_TenantAccountRole.ADMIN,
            _member_service_TenantAccountRole.DATASET_OPERATOR,
        ],
    )
    def test_rbac_role_managers_cannot_transfer_ownership(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        sqlite_session: Session,
        operator_role: _member_service_TenantAccountRole,
    ) -> None:
        workspace_id, owner_id, operator_id = members
        membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == operator_id))
        assert membership is not None
        membership.role = operator_role
        target = Account(name="Target", email="target@example.com")
        sqlite_session.add_all(
            [
                target,
                TenantAccountJoin(
                    tenant_id=workspace_id, account_id=target.id, role=_member_service_TenantAccountRole.NORMAL
                ),
            ]
        )
        sqlite_session.commit()
        account_domain.access.rbac_enabled = True
        account_domain.access.permission_keys.return_value = {"workspace.role.manage"}

        with pytest.raises(NoPermissionError):
            account_domain.members.update_role(workspace_id, target.id, "owner", operator_id)

        account_domain.access.transfer_owner.assert_not_called()
        account_domain.access.change_role.assert_not_called()
        assert account_domain.members.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        assert account_domain.members.get_role(workspace_id, target.id) == _member_service_TenantAccountRole.NORMAL

    @staticmethod
    def test_rbac_normal_role_manager_can_update_another_non_owner(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        sqlite_session: Session,
        rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
    ) -> None:
        workspace_id, owner_id, operator_id = members
        target = Account(name="Target", email="target@example.com")
        sqlite_session.add_all(
            [
                target,
                TenantAccountJoin(
                    tenant_id=workspace_id, account_id=target.id, role=_member_service_TenantAccountRole.NORMAL
                ),
            ]
        )
        sqlite_session.commit()
        gateway, replace = rbac_access
        service = WorkspaceMemberService(
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
        )

        service.update_role(workspace_id, target.id, "editor", operator_id)

        assert len(replace.calls) == 1
        assert replace.calls[0].member_account_id == target.id
        assert replace.calls[0].role_ids == ["role-editor"]
        assert service.get_role(workspace_id, target.id) == _member_service_TenantAccountRole.EDITOR
        assert service.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER

    @staticmethod
    @pytest.mark.parametrize(
        "role",
        [
            _member_service_TenantAccountRole.ADMIN,
            _member_service_TenantAccountRole.EDITOR,
            _member_service_TenantAccountRole.NORMAL,
            _member_service_TenantAccountRole.DATASET_OPERATOR,
        ],
    )
    @pytest.mark.parametrize("remote_fails", [False, True])
    def test_rbac_role_update_assigns_requested_role_and_synchronizes_membership(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        sqlite_session: Session,
        rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
        role: _member_service_TenantAccountRole,
        remote_fails: bool,
    ) -> None:
        workspace_id, owner_id, member_id = members
        previous = (
            _member_service_TenantAccountRole.EDITOR
            if role == _member_service_TenantAccountRole.NORMAL
            else _member_service_TenantAccountRole.NORMAL
        )
        membership = sqlite_session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == member_id))
        assert membership is not None
        membership.role = previous
        sqlite_session.commit()
        gateway, replace = rbac_access
        service = WorkspaceMemberService(
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
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
        assert service.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER

    @staticmethod
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
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
        )

        service.update_role(workspace_id, member_id, "owner", owner_id)

        assert [(call.member_account_id, call.role_ids) for call in replace.calls] == [
            (owner_id, ["custom"]),
            (member_id, ["role-owner"]),
        ]
        assert service.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.NORMAL
        assert service.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.OWNER

    @staticmethod
    @pytest.mark.parametrize("operation", ["demote_new_owner", "transfer_to_another_member"])
    def test_rbac_owner_is_protected_after_local_transfer_commit_fails(
        account_domain: AccountDomain,
        members: tuple[str, str, str],
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        rbac_access: tuple[DeploymentWorkspaceMemberAccessGateway, RecordedRoleAssignments],
        monkeypatch: pytest.MonkeyPatch,
        operation: str,
    ) -> None:
        workspace_id, old_owner_id, new_owner_id = members
        third_member = Account(name="Third", email="third@example.com")
        sqlite_session.add_all(
            [
                third_member,
                TenantAccountJoin(
                    tenant_id=workspace_id, account_id=third_member.id, role=_member_service_TenantAccountRole.NORMAL
                ),
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

        def replace_roles(*, tenant_id: str, account_id: str, member_account_id: str, role_ids: list[str]) -> None:
            del tenant_id, account_id
            remote_roles[member_account_id] = [
                roles_by_id.get(role_id, RBACRole(id=role_id, name=role_id, type="")) for role_id in role_ids
            ]

        def fail_commit(session: Session) -> None:
            session.flush()
            raise RuntimeError("Membership commit failed")

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
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
        )

        event.listen(sqlite_session_factory, "before_commit", fail_commit)
        try:
            with pytest.raises(RuntimeError, match="Membership commit failed"):
                service.update_role(workspace_id, new_owner_id, "owner", old_owner_id)
        finally:
            event.remove(sqlite_session_factory, "before_commit", fail_commit)

        assert remote_roles[old_owner_id] == [custom_role]
        assert remote_roles[new_owner_id] == [owner_role]
        assert service.get_role(workspace_id, old_owner_id) == _member_service_TenantAccountRole.OWNER
        assert service.get_role(workspace_id, new_owner_id) == _member_service_TenantAccountRole.NORMAL
        replace.calls.clear()

        target_id, role = (new_owner_id, "editor") if operation == "demote_new_owner" else (third_member.id, "owner")
        with pytest.raises(NoPermissionError):
            service.update_role(workspace_id, target_id, role, old_owner_id)

        assert replace.calls == []
        assert remote_roles[old_owner_id] == [custom_role]
        assert remote_roles[new_owner_id] == [owner_role]
        assert remote_roles[third_member.id] == []
        assert service.get_role(workspace_id, old_owner_id) == _member_service_TenantAccountRole.OWNER
        assert service.get_role(workspace_id, new_owner_id) == _member_service_TenantAccountRole.NORMAL
        assert service.get_role(workspace_id, third_member.id) == _member_service_TenantAccountRole.NORMAL

    @staticmethod
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
            workspaces=account_domain.workspaces, accounts=account_domain.repository, access=gateway
        )

        with pytest.raises(RuntimeError, match="RBAC unavailable"):
            service.update_role(workspace_id, member_id, new_role, owner_id)

        assert replace.calls == []
        assert service.get_role(workspace_id, owner_id) == _member_service_TenantAccountRole.OWNER
        assert service.get_role(workspace_id, member_id) == _member_service_TenantAccountRole.NORMAL


def make_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="actor-1",
        active_workspace_id="workspace-1",
    )


def make_member(
    member_id: str,
    *,
    status: str = "active",
    legacy_role: str = "normal",
) -> WorkspaceMemberRecord:
    created_at = datetime(2026, 1, 1)
    return WorkspaceMemberRecord(
        id=member_id,
        name=f"Member {member_id}",
        email=f"{member_id}@example.com",
        avatar=None,
        last_login_at=None,
        last_active_at=created_at,
        created_at=created_at,
        status=status,
        legacy_role=legacy_role,
    )


class RecordingMemberQuery:
    def __init__(self, records: Sequence[WorkspaceMemberRecord]) -> None:
        self.records = tuple(records)
        self.workspace_ids: list[str] = []
        self.requested_roles: list[_workspace_member_query_service_TenantAccountRole | None] = []

    def list_for_workspace(
        self, workspace_id: str, *, role: _workspace_member_query_service_TenantAccountRole | None = None
    ) -> Sequence[WorkspaceMemberRecord]:
        self.workspace_ids.append(workspace_id)
        self.requested_roles.append(role)
        return self.records


class RecordingRoleResolver:
    def __init__(self, roles: Mapping[str, Sequence[WorkspaceMemberRole]]) -> None:
        self.roles = roles
        self.calls: list[tuple[str, str, tuple[WorkspaceMemberRoleSubject, ...]]] = []
        self.languages: list[str | None] = []

    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
        *,
        language: str | None = None,
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        self.calls.append((workspace_id, actor_account_id, tuple(subjects)))
        self.languages.append(language)
        return self.roles


class FailingRoleResolver:
    def resolve_many(
        self,
        workspace_id: str,
        actor_account_id: str,
        subjects: Sequence[WorkspaceMemberRoleSubject],
        *,
        language: str | None = None,
    ) -> Mapping[str, Sequence[WorkspaceMemberRole]]:
        del workspace_id, actor_account_id, subjects, language
        raise RoleResolutionError


class RoleResolutionError(Exception):
    pass


class TestWorkspaceMemberQueryServiceCases:
    @staticmethod
    @pytest.mark.parametrize("language", [None, "ja"])
    def test_list_current_projects_members_and_merges_roles_by_account_id(language: str | None) -> None:
        active = make_member("active", legacy_role="owner")
        pending = make_member("pending", status="pending")
        members = RecordingMemberQuery([active, pending])
        roles = RecordingRoleResolver(
            {
                active.id: [
                    WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                    WorkspaceMemberRole(id="workspace.editor", name="Editor"),
                ]
            }
        )
        service = WorkspaceMemberQueryService(members=members, roles=roles)

        result = service.list_current(make_context(), language=language)

        by_id = {member.id: member for member in result}
        assert set(by_id) == {"active", "pending"}
        assert by_id["active"] == WorkspaceMemberSummary(
            id=active.id,
            name=active.name,
            email=active.email,
            avatar=active.avatar,
            last_login_at=active.last_login_at,
            last_active_at=active.last_active_at,
            created_at=active.created_at,
            role=active.legacy_role,
            roles=(
                WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                WorkspaceMemberRole(id="workspace.editor", name="Editor"),
            ),
            status=active.status,
        )
        assert by_id["pending"].status == "pending"
        assert by_id["pending"].roles == ()
        assert members.workspace_ids == ["workspace-1"]
        assert roles.languages == [language]
        assert roles.calls == [
            (
                "workspace-1",
                "actor-1",
                (
                    WorkspaceMemberRoleSubject(account_id=active.id, legacy_role=active.legacy_role),
                    WorkspaceMemberRoleSubject(account_id=pending.id, legacy_role=pending.legacy_role),
                ),
            )
        ]

    @staticmethod
    def test_list_current_propagates_role_resolution_failure() -> None:
        members = RecordingMemberQuery([make_member("member-1")])
        service = WorkspaceMemberQueryService(members=members, roles=FailingRoleResolver())

        with pytest.raises(RoleResolutionError):
            service.list_current(make_context())

    @staticmethod
    @pytest.mark.parametrize("operators_only", [True, False])
    def test_member_listing_passes_role_filter_to_repository(operators_only: bool) -> None:
        records = [make_member("operator", legacy_role="dataset_operator")]
        members = RecordingMemberQuery(records)
        roles = RecordingRoleResolver({})
        service = WorkspaceMemberQueryService(members=members, roles=roles)

        assert service.list_members("workspace-1", dataset_operators_only=operators_only) == tuple(records)
        assert members.workspace_ids == ["workspace-1"]
        assert members.requested_roles == [
            _workspace_member_query_service_TenantAccountRole.DATASET_OPERATOR if operators_only else None
        ]
        assert roles.calls == []

    @staticmethod
    @pytest.mark.parametrize(
        ("count", "page", "limit", "expected_ids"),
        [(5, 2, 2, ["2", "3"]), (5, 3, 2, ["4"]), (5, 4, 2, []), (0, 1, 20, [])],
    )
    def test_member_page_preserves_total_and_order(count: int, page: int, limit: int, expected_ids: list[str]) -> None:
        members = RecordingMemberQuery([make_member(str(index)) for index in range(count)])
        roles = RecordingRoleResolver({})
        service = WorkspaceMemberQueryService(members=members, roles=roles)

        result = service.list_page(make_context(), page=page, limit=limit)

        assert result.total == count
        assert [member.id for member in result.members] == expected_ids
        assert members.workspace_ids == ["workspace-1"]
        assert roles.calls == []

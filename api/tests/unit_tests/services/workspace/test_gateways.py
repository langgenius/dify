"""Workspace policies and notifications with only external clients replaced."""

from collections.abc import Callable
from unittest.mock import Mock

import pytest

from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from services.account.adapters import RedisInvitationTokenStore
from services.enterprise.enterprise_service import WorkspacePermission
from services.entities.feature_entities import FeatureModel, LicenseLimitationModel, LicenseModel, LimitationModel
from services.errors.base import NoPermissionError
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspaceMemberLicenseQuotaError
from services.workspace import gateways
from tests.unit_tests.account_domain import AccountDomain


@pytest.fixture
def invitations() -> gateways.WorkspaceInvitationGateway:
    redis = Mock(spec=RedisClientWrapper)
    return gateways.WorkspaceInvitationGateway(tokens=RedisInvitationTokenStore(redis=redis), redis=redis)


@pytest.mark.parametrize("allowed", [True, False])
def test_invitation_policy_exposes_domain_errors(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    requested: list[str] = []

    def get_permission(workspace_id: str) -> WorkspacePermission:
        requested.append(workspace_id)
        return WorkspacePermission(workspaceId=workspace_id, allowMemberInvite=allowed)

    monkeypatch.setattr(gateways.EnterpriseService.WorkspacePermissionService, "get_permission", get_permission)
    if allowed:
        invitations.ensure_allowed("workspace")
    else:
        with pytest.raises(NoPermissionError, match="Workspace policy prohibits member invitations"):
            invitations.ensure_allowed("workspace")
    assert requested == ["workspace"]


@pytest.mark.parametrize(("limit", "allowed"), [(0, True), (-1, True), (4, True), (5, True), (3, False)])
def test_cloud_invitation_member_limit(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    limit: int,
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    # Use the repository's current count, not a potentially stale billing size.
    features = Mock(return_value=FeatureModel(members=LimitationModel(size=99, limit=limit)))
    license_query = Mock(spec=gateways.SystemFeatureService.get_license)
    monkeypatch.setattr(gateways.FeatureService, "get_features", features)
    monkeypatch.setattr(gateways.SystemFeatureService, "get_license", license_query)

    assert invitations.requires_capacity_check
    if allowed:
        invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=1)
    else:
        with pytest.raises(WorkspaceInvitationQuotaError) as error:
            invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=1)
        assert error.value.seats is False
    features.assert_called_once_with(tenant_id="workspace", exclude_vector_space=True)
    license_query.assert_not_called()


@pytest.mark.parametrize(
    ("member_quota", "seat_quota", "new_accounts", "failure"),
    [
        (
            LicenseLimitationModel(enabled=True, size=2, limit=4),
            LicenseLimitationModel(enabled=True, size=9, limit=10),
            1,
            None,
        ),
        (
            LicenseLimitationModel(enabled=True, size=3, limit=4),
            LicenseLimitationModel(enabled=True, size=9, limit=10),
            1,
            "members",
        ),
        (LicenseLimitationModel(), LicenseLimitationModel(enabled=True, size=10, limit=10), 1, "seats"),
        (LicenseLimitationModel(), LicenseLimitationModel(enabled=True, size=9, limit=10), 2, "seats"),
        (LicenseLimitationModel(), LicenseLimitationModel(enabled=True, size=8, limit=10), 2, None),
        (LicenseLimitationModel(), LicenseLimitationModel(enabled=True, size=10, limit=10), 0, None),
        (
            LicenseLimitationModel(enabled=True, size=99, limit=0),
            LicenseLimitationModel(enabled=True, size=99, limit=0),
            2,
            None,
        ),
        (
            LicenseLimitationModel(enabled=False, size=99, limit=1),
            LicenseLimitationModel(enabled=False, size=99, limit=1),
            2,
            None,
        ),
    ],
    ids=[
        "exact-capacity",
        "workspace-full",
        "seats-full",
        "not-enough-seats-for-batch",
        "exact-seats-for-batch",
        "existing-accounts",
        "unlimited",
        "disabled",
    ],
)
def test_enterprise_invitation_member_and_seat_limits(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    member_quota: LicenseLimitationModel,
    seat_quota: LicenseLimitationModel,
    new_accounts: int,
    failure: str | None,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        gateways.FeatureService, "get_features", Mock(return_value=FeatureModel(workspace_members=member_quota))
    )
    license_query = Mock(return_value=LicenseModel(seats=seat_quota))
    monkeypatch.setattr(gateways.SystemFeatureService, "get_license", license_query)

    assert invitations.requires_capacity_check
    if failure is None:
        invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=new_accounts)
    else:
        with pytest.raises(WorkspaceInvitationQuotaError) as error:
            invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=new_accounts)
        assert error.value.seats is (failure == "seats")
    assert license_query.call_count == int(new_accounts > 0 and failure != "members")


def test_community_invitation_does_not_query_quotas(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    features = Mock(spec=gateways.FeatureService.get_features)
    license_query = Mock(spec=gateways.SystemFeatureService.get_license)
    monkeypatch.setattr(gateways.FeatureService, "get_features", features)
    monkeypatch.setattr(gateways.SystemFeatureService, "get_license", license_query)

    assert not invitations.requires_capacity_check
    invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=1)
    features.assert_not_called()
    license_query.assert_not_called()


@pytest.mark.parametrize(
    ("edition", "plan_limit", "license_quota", "error"),
    [
        (DeploymentEdition.CLOUD, 2, LicenseLimitationModel(), WorkspaceInvitationQuotaError),
        (DeploymentEdition.CLOUD, 3, LicenseLimitationModel(), None),
        (DeploymentEdition.CLOUD, 0, LicenseLimitationModel(), None),
        (DeploymentEdition.CLOUD, -1, LicenseLimitationModel(), None),
        (
            DeploymentEdition.ENTERPRISE,
            2,
            LicenseLimitationModel(enabled=True, size=2, limit=2),
            WorkspaceMemberLicenseQuotaError,
        ),
        (DeploymentEdition.ENTERPRISE, 2, LicenseLimitationModel(enabled=True, size=2, limit=3), None),
        (DeploymentEdition.ENTERPRISE, 2, LicenseLimitationModel(enabled=True, size=2, limit=0), None),
        (DeploymentEdition.COMMUNITY, 2, LicenseLimitationModel(enabled=False, size=2, limit=2), None),
        (
            DeploymentEdition.CLOUD,
            3,
            LicenseLimitationModel(enabled=True, size=2, limit=2),
            WorkspaceMemberLicenseQuotaError,
        ),
    ],
)
def test_single_invitation_quota_preserves_plan_and_license_limits(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    plan_limit: int,
    license_quota: LicenseLimitationModel,
    error: type[WorkspaceInvitationQuotaError] | None,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    features = FeatureModel(members=LimitationModel(size=2, limit=plan_limit), workspace_members=license_quota)
    requested: list[str] = []

    def get_features(tenant_id: str, *, exclude_vector_space: bool = False) -> FeatureModel:
        requested.append(tenant_id)
        assert exclude_vector_space
        return features

    monkeypatch.setattr(gateways.FeatureService, "get_features", get_features)

    if error is None:
        invitations.check_invitation_quota("workspace")
    else:
        with pytest.raises(error):
            invitations.check_invitation_quota("workspace")
    assert requested == ["workspace"]


def test_owner_transfer_notifies_both_owners(account_domain: AccountDomain, monkeypatch: pytest.MonkeyPatch) -> None:
    old_owner = account_domain.accounts.create_account("old@example.com", "Old", "en-US")
    new_owner = account_domain.accounts.create_account("new@example.com", "New", "en-US")
    old_notification = Mock(spec=gateways.send_old_owner_transfer_notify_email_task.delay)
    new_notification = Mock(spec=gateways.send_new_owner_transfer_notify_email_task.delay)
    monkeypatch.setattr(gateways.send_old_owner_transfer_notify_email_task, "delay", old_notification)
    monkeypatch.setattr(gateways.send_new_owner_transfer_notify_email_task, "delay", new_notification)

    gateway = gateways.WorkspaceOwnerTransferGateway(redis=Mock(spec=RedisClientWrapper))
    gateway.notify(old_owner=old_owner, new_owner=new_owner, workspace_name="Workspace")

    new_notification.assert_called_once_with(language="en-US", to=new_owner.email, workspace="Workspace")
    old_notification.assert_called_once_with(
        language="en-US", to=old_owner.email, workspace="Workspace", new_owner_email=new_owner.email
    )

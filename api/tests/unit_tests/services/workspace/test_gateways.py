"""Workspace policies and notifications with only external clients replaced."""

from collections.abc import Callable
from unittest.mock import Mock, create_autospec

import httpx
import pytest

from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from services.account.adapters import RedisInvitationTokenStore
from services.enterprise.enterprise_service import WorkspacePermission
from services.entities.feature_entities import FeatureModel, LicenseLimitationModel, LicenseModel, LimitationModel
from services.errors.base import NoPermissionError
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspaceMemberLicenseQuotaError
from services.workspace import gateways
from services.workspace.contracts import WorkspaceOwnerTransferNotification
from tests.unit_tests.account_domain import AccountDomain


@pytest.fixture
def invitations() -> gateways.WorkspaceInvitationGateway:
    redis = create_autospec(RedisClientWrapper, instance=True)
    return gateways.WorkspaceInvitationGateway(
        tokens=RedisInvitationTokenStore(redis=redis),
        redis=redis,
    )


def test_deployment_quota_snapshot_uses_current_license(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        gateways.SystemFeatureService,
        "get_uncached_license",
        lambda: LicenseModel(
            seats=LicenseLimitationModel(enabled=True, size=7, limit=10),
            workspaces=LicenseLimitationModel(enabled=False, size=3, limit=4),
        ),
    )

    snapshot = gateways.DeploymentQuotaSnapshotGateway().snapshot()

    assert snapshot.seat_limit == 10
    assert snapshot.seat_usage == 7
    assert snapshot.workspace_limit is None
    assert snapshot.workspace_usage == 3


@pytest.mark.parametrize(
    ("edition", "expected"),
    [
        (DeploymentEdition.COMMUNITY, (None, 0, None, 0)),
        (DeploymentEdition.CLOUD, (4, 3, 6, 5)),
        (DeploymentEdition.ENTERPRISE, (None, 0, 6, 5)),
    ],
)
def test_workspace_member_quota_snapshot_preserves_plan_and_license_counters(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    expected: tuple[int | None, int, int | None, int],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    feature_requests: list[tuple[str, bool]] = []

    def feature_query(*, tenant_id: str, exclude_vector_space: bool = False) -> FeatureModel:
        feature_requests.append((tenant_id, exclude_vector_space))
        return FeatureModel(
            members=LimitationModel(size=3, limit=4),
            workspace_members=LicenseLimitationModel(enabled=True, size=5, limit=6),
        )

    monkeypatch.setattr(gateways.FeatureService, "get_features", feature_query)

    snapshot = gateways.DeploymentWorkspaceMemberQuotaGateway().snapshot("workspace")

    assert (snapshot.plan_limit, snapshot.plan_usage, snapshot.license_limit, snapshot.license_usage) == expected
    if edition == DeploymentEdition.COMMUNITY:
        assert feature_requests == []
    else:
        assert feature_requests == [("workspace", True)]


def test_workspace_preparation_failure_discards_generated_key(monkeypatch: pytest.MonkeyPatch) -> None:
    generated: list[str] = []
    discarded: list[str] = []
    monkeypatch.setattr(gateways, "generate_key_pair", lambda workspace_id: generated.append(workspace_id) or "key")
    monkeypatch.setattr(gateways, "delete_key_pair", discarded.append)

    def fail_defaults(_workspace_id: str) -> int:
        raise RuntimeError("defaults unavailable")

    monkeypatch.setattr(
        gateways.PluginAutoUpgradeService,
        "default_upgrade_time_of_day",
        fail_defaults,
    )

    with pytest.raises(RuntimeError, match="defaults unavailable"):
        gateways.WorkspaceProvisioningEffectsGateway().prepare("workspace", "Test")

    assert generated == ["workspace"]
    assert discarded == ["workspace"]


def test_workspace_key_discard_uses_configured_key_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    discarded: list[str] = []
    monkeypatch.setattr(gateways, "delete_key_pair", discarded.append)

    gateway = gateways.WorkspaceProvisioningEffectsGateway()
    gateway.discard_key("workspace")
    gateway.discard_key("workspace")

    assert discarded == ["workspace", "workspace"]


def test_workspace_owner_binding_retries_transient_rbac_failure(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=True)
    attempts: list[str] = []
    monkeypatch.setattr(
        gateways.DeploymentWorkspaceMemberAccessGateway,
        "_role_id",
        lambda _workspace_id, _account_id, _tag: "owner-role",
    )

    def replace(**kwargs: object) -> object:
        attempts.append(str(kwargs["tenant_id"]))
        if len(attempts) == 1:
            raise httpx.ConnectError("temporary RBAC failure")
        return object()

    monkeypatch.setattr(gateways.RBACService.MemberRoles, "replace", replace)

    gateways.WorkspaceProvisioningEffectsGateway().bind_owner("workspace", "account")

    assert attempts == ["workspace", "workspace"]


def test_workspace_owner_unbind_is_idempotent_and_retries_transient_failure(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(RBAC_ENABLED=True)
    attempts: list[tuple[str, str]] = []

    def delete_rbac_bindings(tenant_id: str, account_id: str) -> object:
        attempts.append((tenant_id, account_id))
        if len(attempts) == 1:
            raise httpx.ConnectError("temporary RBAC failure")
        return object()

    monkeypatch.setattr(gateways.RBACService.MemberRoles, "delete_rbac_bindings", delete_rbac_bindings)

    gateway = gateways.WorkspaceProvisioningEffectsGateway()
    gateway.unbind_owner("workspace", "account")
    gateway.unbind_owner("workspace", "account")

    assert attempts == [
        ("workspace", "account"),
        ("workspace", "account"),
        ("workspace", "account"),
    ]


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
    license_query = create_autospec(gateways.SystemFeatureService.get_license, instance=True)
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
    ("member_quota", "failure"),
    [
        (LicenseLimitationModel(enabled=True, size=2, limit=4), None),
        (LicenseLimitationModel(enabled=True, size=3, limit=4), "members"),
        (LicenseLimitationModel(enabled=True, size=99, limit=0), None),
        (LicenseLimitationModel(enabled=False, size=99, limit=1), None),
    ],
    ids=["exact-capacity", "workspace-full", "unlimited", "disabled"],
)
def test_enterprise_invitation_member_limits(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    member_quota: LicenseLimitationModel,
    failure: str | None,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(
        gateways.FeatureService, "get_features", Mock(return_value=FeatureModel(workspace_members=member_quota))
    )
    assert invitations.requires_capacity_check
    if failure is None:
        invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=2)
    else:
        with pytest.raises(WorkspaceInvitationQuotaError) as error:
            invitations.check_capacity("workspace", current_members=2, new_members=2, new_accounts=2)
        assert error.value.seats is False


def test_community_invitation_does_not_query_quotas(
    invitations: gateways.WorkspaceInvitationGateway,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    features = create_autospec(gateways.FeatureService.get_features, instance=True)
    license_query = create_autospec(gateways.SystemFeatureService.get_license, instance=True)
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
    old_notification = create_autospec(gateways.send_old_owner_transfer_notify_email_task.apply_async, instance=True)
    new_notification = create_autospec(gateways.send_new_owner_transfer_notify_email_task.apply_async, instance=True)
    monkeypatch.setattr(gateways.send_old_owner_transfer_notify_email_task, "apply_async", old_notification)
    monkeypatch.setattr(gateways.send_new_owner_transfer_notify_email_task, "apply_async", new_notification)

    gateway = gateways.WorkspaceOwnerTransferGateway(redis=create_autospec(RedisClientWrapper, instance=True))
    gateway.notify(
        WorkspaceOwnerTransferNotification(
            notification_id="new-notification-id",
            operation_id="operation-id",
            workspace_id="workspace-id",
            old_owner_account_id=old_owner.id,
            new_owner_account_id=new_owner.id,
            recipient_type="new_owner",
            recipient_email=new_owner.email,
            recipient_language="en-US",
            workspace_name="Workspace",
            new_owner_email=new_owner.email,
            claim_id="claim-id",
        )
    )
    gateway.notify(
        WorkspaceOwnerTransferNotification(
            notification_id="old-notification-id",
            operation_id="operation-id",
            workspace_id="workspace-id",
            old_owner_account_id=old_owner.id,
            new_owner_account_id=new_owner.id,
            recipient_type="old_owner",
            recipient_email=old_owner.email,
            recipient_language="en-US",
            workspace_name="Workspace",
            new_owner_email=new_owner.email,
            claim_id="claim-id",
        )
    )

    headers = {
        "workspace_owner_transfer_operation_id": "operation-id",
        "workspace_owner_transfer_recipient": "new_owner",
    }
    new_notification.assert_called_once_with(
        kwargs={"language": "en-US", "to": new_owner.email, "workspace": "Workspace"},
        task_id="new-notification-id",
        headers=headers,
    )
    old_notification.assert_called_once_with(
        kwargs={
            "language": "en-US",
            "to": old_owner.email,
            "workspace": "Workspace",
            "new_owner_email": new_owner.email,
        },
        task_id="old-notification-id",
        headers={**headers, "workspace_owner_transfer_recipient": "old_owner"},
    )

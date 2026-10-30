from collections.abc import Callable
from unittest.mock import Mock, create_autospec

import pytest

from core.model_billing_profile import ModelBillingSource, TenantModelBillingResolution
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from machinery.context import RequestContext
from models.account import Account
from models.tokener import TenantTokenerIntegrationStatus
from services.account.adapters import RedisInvitationTokenStore
from services.credit_pool_service import CreditPoolBalance
from services.enterprise.base import EnterpriseRequest
from services.enterprise.enterprise_service import WorkspacePermission
from services.entities.feature_entities import FeatureModel, LicenseLimitationModel, LicenseModel, LimitationModel
from services.errors.base import NoPermissionError
from services.errors.billing import BillingUpstreamUnavailableError, LegacyCreditPoolManagedByTokenerError
from services.errors.workspace import WorkspaceInvitationQuotaError, WorkspaceMemberLicenseQuotaError
from services.file_service import FileService
from services.workspace import gateways
from services.workspace.contracts import EffectiveCreditPool, WorkspaceMemberRole, WorkspaceMemberRoleSubject
from services.workspace.gateways import (
    DeploymentWorkspaceFeatureGateway,
    DeploymentWorkspaceMemberRoleResolver,
    DeploymentWorkspacePlanGateway,
    WorkspaceFileGateway,
)
from tests.helpers.unit.account_domain import AccountDomain
from tests.helpers.unit.rbac_fakes import RBACTransport

"""Workspace policies and notifications with only external clients replaced."""


class TestGatewaysCases:
    @staticmethod
    @pytest.fixture
    def invitations() -> gateways.WorkspaceInvitationGateway:
        redis = create_autospec(RedisClientWrapper, instance=True)
        return gateways.WorkspaceInvitationGateway(tokens=RedisInvitationTokenStore(redis=redis), redis=redis)

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_owner_transfer_notifies_both_owners(
        account_domain: AccountDomain, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        old_owner = account_domain.accounts.create_account("old@example.com", "Old", "en-US")
        new_owner = account_domain.accounts.create_account("new@example.com", "New", "en-US")
        old_notification = create_autospec(gateways.send_old_owner_transfer_notify_email_task.delay, instance=True)
        new_notification = create_autospec(gateways.send_new_owner_transfer_notify_email_task.delay, instance=True)
        monkeypatch.setattr(gateways.send_old_owner_transfer_notify_email_task, "delay", old_notification)
        monkeypatch.setattr(gateways.send_new_owner_transfer_notify_email_task, "delay", new_notification)

        gateway = gateways.WorkspaceOwnerTransferGateway(redis=create_autospec(RedisClientWrapper, instance=True))
        gateway.notify(old_owner=old_owner, new_owner=new_owner, workspace_name="Workspace")

        new_notification.assert_called_once_with(language="en-US", to=new_owner.email, workspace="Workspace")
        old_notification.assert_called_once_with(
            language="en-US", to=old_owner.email, workspace="Workspace", new_owner_email=new_owner.email
        )


"""Deployment billing adapter and paid-to-trial fallback regressions."""


class TestWorkspaceCreditPoolCases:
    @staticmethod
    @pytest.mark.parametrize(
        ("plan", "paid_quota", "paid_used", "trial_quota", "expected_type", "remaining"),
        [
            (CloudPlan.TEAM, 500, 120, 100, "paid", 380),
            (CloudPlan.TEAM, -1, 999, 100, "paid", -1),
            (CloudPlan.TEAM, 500, 500, 100, "trial", 60),
            (CloudPlan.TEAM, None, 0, 100, "trial", 60),
            (CloudPlan.SANDBOX, 500, 0, 100, "trial", 60),
            (CloudPlan.SANDBOX, None, 0, None, None, None),
        ],
    )
    def test_effective_credit_pool(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        plan: CloudPlan | None,
        paid_quota: int | None,
        paid_used: int,
        trial_quota: int | None,
        expected_type: str | None,
        remaining: int | None,
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        monkeypatch.setattr(
            gateways.BillingService,
            "get_info",
            lambda *_a, **_k: {"subscription": {"plan": plan}, "next_credit_reset_date": 1775001600},
        )
        paid = CreditPoolBalance("tenant", "paid", paid_quota, paid_used) if paid_quota is not None else None
        trial = CreditPoolBalance("tenant", "trial", trial_quota, 40) if trial_quota is not None else None
        calls = []

        def get_pool(*, tenant_id: str, pool_type: str) -> CreditPoolBalance | None:
            calls.append((tenant_id, pool_type))
            return paid if pool_type == "paid" else trial

        monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
        result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
        assert result.pool_type == expected_type
        assert result.remaining_credits == remaining
        assert result.next_credit_reset_date == 1775001600
        if plan == CloudPlan.SANDBOX:
            assert calls == [("tenant", "trial")]
        elif expected_type == "paid":
            assert calls == [("tenant", "paid")]
        else:
            assert calls == [("tenant", "paid"), ("tenant", "trial")]

    @staticmethod
    @pytest.mark.parametrize(
        ("quota", "used", "exhausted_at", "expected"),
        [(100, 100, 123, 123), (100, 10, 123, None), (-1, 100, 123, None), (100, 100, 0, None)],
    )
    def test_feature_info_uses_same_pool_rules(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        quota: int,
        used: int,
        exhausted_at: int | None,
        expected: int | None,
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        features = FeatureModel(can_replace_logo=True)
        monkeypatch.setattr(gateways.FeatureService, "get_features", lambda *_a, **_k: features)
        monkeypatch.setattr(
            gateways.CreditPoolService,
            "get_pool",
            lambda **_k: CreditPoolBalance("tenant", "trial", quota, used, exhausted_at),
        )
        result = DeploymentWorkspaceFeatureGateway().get_features("tenant")
        assert result.can_replace_logo
        assert result.credits.exhausted_at == expected

    @staticmethod
    @pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
    def test_non_cloud_summary_skips_external_io(
        monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], edition: DeploymentEdition
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=edition)
        billing = Mock(side_effect=AssertionError("billing must not be queried"))
        monkeypatch.setattr(gateways.BillingService, "get_info", billing)
        result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
        assert result.plan is None
        assert result.remaining_credits is None
        billing.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(
        ("edition", "bulk", "expected", "fallback_ids"),
        [
            (DeploymentEdition.CLOUD, {"w1": {"plan": "team"}}, {"w1": "team", "w2": None}, []),
            (DeploymentEdition.CLOUD, {}, {"w1": None, "w2": None}, []),
            (DeploymentEdition.CLOUD, {"w1": {"plan": ""}}, {"w1": None, "w2": None}, []),
            (
                DeploymentEdition.CLOUD,
                {"w1": {"plan": "sandbox"}, "w2": {"plan": "professional"}},
                {"w1": "sandbox", "w2": "professional"},
                [],
            ),
            (DeploymentEdition.COMMUNITY, {}, {"w1": "professional", "w2": "professional"}, ["w1", "w2"]),
            (DeploymentEdition.ENTERPRISE, {}, {"w1": "sandbox", "w2": "sandbox"}, []),
        ],
    )
    def test_plan_gateway_bulk_and_fallback(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        edition: DeploymentEdition,
        bulk: dict[str, dict[str, str]],
        expected: dict[str, str | None],
        fallback_ids: list[str],
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=edition)
        bulk_query = Mock(return_value=bulk)
        features = FeatureModel()
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        feature_query = Mock(return_value=features)
        monkeypatch.setattr(gateways.BillingService, "get_plan_bulk", bulk_query)
        monkeypatch.setattr(gateways.FeatureService, "get_features", feature_query)
        assert DeploymentWorkspacePlanGateway().resolve_many(["w1", "w2"]) == expected
        assert [call.args[0] for call in feature_query.call_args_list] == fallback_ids
        assert bulk_query.call_count == int(edition == DeploymentEdition.CLOUD)

    @staticmethod
    def test_cloud_plan_list_failure_does_not_fan_out_to_features(
        monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], caplog: pytest.LogCaptureFixture
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        bulk_query = Mock(side_effect=RuntimeError("private upstream subscription detail"))
        features = Mock(side_effect=AssertionError("List failure must not trigger more billing requests"))
        monkeypatch.setattr(gateways.BillingService, "get_plan_bulk", bulk_query)
        monkeypatch.setattr(gateways.FeatureService, "get_features", features)

        assert DeploymentWorkspacePlanGateway().resolve_many(["w1", "w2"]) == {"w1": None, "w2": None}
        bulk_query.assert_called_once_with(("w1", "w2"))
        features.assert_not_called()
        assert "private upstream" not in caplog.text

    @staticmethod
    def test_empty_workspace_plan_list_does_not_query_any_source(monkeypatch: pytest.MonkeyPatch) -> None:
        bulk_query = Mock(side_effect=AssertionError("No workspaces to resolve"))
        features = Mock(side_effect=AssertionError("No workspaces to resolve"))
        monkeypatch.setattr(gateways.BillingService, "get_plan_bulk", bulk_query)
        monkeypatch.setattr(gateways.FeatureService, "get_features", features)
        assert DeploymentWorkspacePlanGateway().resolve_many([]) == {}
        bulk_query.assert_not_called()
        features.assert_not_called()


"""File adapter keeps admitted identity explicit across the FileService boundary."""


class TestWorkspaceFileGatewayCases:
    @staticmethod
    def test_upload_uses_admitted_account_and_explicit_workspace() -> None:
        files = create_autospec(FileService, instance=True)
        files.upload_file.return_value = Mock(id="file-id")
        gateway = WorkspaceFileGateway(files=files)
        context = RequestContext("request", None, "account", "workspace")

        assert gateway.upload(context, filename="logo.png", content=b"image", mimetype="image/png") == "file-id"

        kwargs = files.upload_file.call_args.kwargs
        assert isinstance(kwargs["user"], Account)
        assert kwargs["user"].id == "account"
        assert kwargs["tenant_id"] == "workspace"
        assert kwargs["content"] == b"image"


def make_subject(account_id: str, *, legacy_role: str = "normal") -> WorkspaceMemberRoleSubject:
    return WorkspaceMemberRoleSubject(account_id=account_id, legacy_role=legacy_role)


class RoleResolutionError(Exception):
    pass


class TestWorkspaceMemberRoleResolverCases:
    @staticmethod
    @pytest.fixture
    def transport(monkeypatch: pytest.MonkeyPatch) -> RBACTransport:
        transport = RBACTransport()
        monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
        return transport

    @staticmethod
    def test_builtin_mode_projects_join_roles_without_enterprise_call(
        config_overrides: Callable[..., None], transport: RBACTransport
    ) -> None:
        config_overrides(RBAC_ENABLED=False)

        result = DeploymentWorkspaceMemberRoleResolver().resolve_many(
            "workspace-1", "actor-1", [make_subject("owner", legacy_role="owner"), make_subject("member")]
        )

        assert result == {
            "owner": (WorkspaceMemberRole(id="owner", name="owner"),),
            "member": (WorkspaceMemberRole(id="normal", name="normal"),),
        }
        assert transport.requests == []

    @staticmethod
    @pytest.mark.parametrize("language", [None, "ja"])
    def test_rbac_mode_maps_batch_response_without_builtin_fallback(
        config_overrides: Callable[..., None], transport: RBACTransport, language: str | None
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        transport.response = {
            "owner": [
                {"id": "workspace.owner", "name": "Owner", "type": "builtin"},
                {"id": "workspace.editor", "name": "Editor", "type": "builtin"},
            ]
        }

        result = DeploymentWorkspaceMemberRoleResolver().resolve_many(
            "workspace-1",
            "actor-1",
            [make_subject("owner", legacy_role="owner"), make_subject("omitted", legacy_role="admin")],
            language=language,
        )

        assert result == {
            "owner": (
                WorkspaceMemberRole(id="workspace.owner", name="Owner"),
                WorkspaceMemberRole(id="workspace.editor", name="Editor"),
            )
        }
        sent = transport.only_request
        assert (sent.method, sent.endpoint) == ("POST", "/rbac/members/rbac-roles/batch")
        assert (sent.tenant_id, sent.account_id) == ("workspace-1", "actor-1")
        assert sent.json == {"member_ids": ["owner", "omitted"]}
        assert sent.params == ({"language": language} if language else None)

    @staticmethod
    def test_rbac_failure_propagates(config_overrides: Callable[..., None], transport: RBACTransport) -> None:
        config_overrides(RBAC_ENABLED=True)
        transport.failure = RoleResolutionError("enterprise unavailable")

        with pytest.raises(RoleResolutionError, match="enterprise unavailable"):
            DeploymentWorkspaceMemberRoleResolver().resolve_many("workspace-1", "actor-1", [make_subject("member-1")])

    @staticmethod
    def test_empty_member_list_skips_enterprise_call(
        config_overrides: Callable[..., None], transport: RBACTransport
    ) -> None:
        config_overrides(RBAC_ENABLED=True)

        assert DeploymentWorkspaceMemberRoleResolver().resolve_many("workspace-1", "actor-1", []) == {}
        assert transport.requests == []


@pytest.fixture
def legacy_billing_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="none"))
    monkeypatch.setattr(
        gateways.ModelBillingProfileService,
        "resolve",
        Mock(return_value=TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS)),
    )


@pytest.mark.usefixtures("legacy_billing_profile")
def test_migration_processing_does_not_display_old_balance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="processing"))
    get_pool = Mock()
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", get_pool)
    get_metering = Mock()
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.model_billing_migration_status == "processing"
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.tokener_metering is None
    get_pool.assert_not_called()
    get_metering.assert_not_called()


@pytest.mark.parametrize("status", list(TenantTokenerIntegrationStatus))
@pytest.mark.usefixtures("legacy_billing_profile")
def test_tokener_never_reads_legacy_credit_pool(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], status: TenantTokenerIntegrationStatus
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        gateways.ModelBillingProfileService,
        "resolve",
        Mock(return_value=TenantModelBillingResolution(ModelBillingSource.TOKENER, status)),
    )
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": CloudPlan.SANDBOX}})
    )
    get_pool = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.plan == CloudPlan.SANDBOX
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.model_billing_source == ModelBillingSource.TOKENER
    assert result.tokener_bootstrap_status == status.value
    get_pool.assert_not_called()


@pytest.mark.usefixtures("legacy_billing_profile")
def test_ready_tokener_enriches_metering_without_changing_legacy_fields(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    credits = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
        plan=CloudPlan.SANDBOX,
    )
    metering = {
        "tenant_id": "tenant",
        "currency": "USD",
        "available_usd_micro": "12500000",
        "current_month": {
            "status": "available",
            "start_date": "2026-09-01",
            "end_date": "2026-09-03",
            "billed_usd_micro": "3750000",
            "request_count": "42",
        },
        "balance_generated_at": "2026-09-03T06:00:00Z",
        "usage_generated_at": "2026-09-03T05:59:30Z",
    }
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    get_metering = Mock(return_value=metering)
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.tokener_metering == metering
    assert result.remaining_credits is None
    assert not result.is_exhausted
    get_metering.assert_called_once_with("tenant")


@pytest.mark.parametrize(
    "credits",
    [
        EffectiveCreditPool(),
        EffectiveCreditPool(
            model_billing_source=ModelBillingSource.TOKENER,
            tokener_bootstrap_status=TenantTokenerIntegrationStatus.PENDING.value,
        ),
    ],
)
@pytest.mark.usefixtures("legacy_billing_profile")
def test_legacy_or_pending_does_not_query_metering(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], credits: EffectiveCreditPool
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    get_metering = Mock()
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    assert DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant") is credits
    get_metering.assert_not_called()


@pytest.mark.usefixtures("legacy_billing_profile")
def test_metering_outage_keeps_ready_balance_shape(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    credits = EffectiveCreditPool(
        model_billing_source=ModelBillingSource.TOKENER,
        tokener_bootstrap_status=TenantTokenerIntegrationStatus.READY.value,
    )
    monkeypatch.setattr(DeploymentWorkspaceFeatureGateway, "get_effective_credit_pool", Mock(return_value=credits))
    monkeypatch.setattr(
        gateways.BillingService, "get_tokener_metering", Mock(side_effect=BillingUpstreamUnavailableError)
    )
    assert DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant") is credits


@pytest.mark.parametrize("migration_status", ["processing", "active"])
@pytest.mark.usefixtures("legacy_billing_profile")
def test_workspace_credit_snapshot_never_reads_fenced_balance(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], migration_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value=migration_status))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.plan == CloudPlan.PROFESSIONAL
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert result.model_billing_migration_status == migration_status
    assert result.model_billing_source == ("tokener" if migration_status == "active" else "legacy_message_credits")
    get_pool.assert_not_called()


@pytest.mark.usefixtures("legacy_billing_profile")
def test_preparation_still_displays_legacy_balance(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value="preparing"))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(return_value=CreditPoolBalance("tenant", "paid", 100, 20))
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    result = DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    assert result.remaining_credits == 80
    assert result.model_billing_migration_status == "preparing"
    get_pool.assert_called_once_with(tenant_id="tenant", pool_type="paid")


@pytest.mark.parametrize("latest_status", ["processing", "active"])
@pytest.mark.usefixtures("legacy_billing_profile")
def test_claim_race_refreshes_authority_without_trial_fallback(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], latest_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    status = Mock(side_effect=["preparing", "preparing", latest_status])
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", status)
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(side_effect=LegacyCreditPoolManagedByTokenerError)
    get_metering = Mock()
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    monkeypatch.setattr(gateways.BillingService, "get_tokener_metering", get_metering)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits("tenant")
    assert result.model_billing_migration_status == latest_status
    assert result.model_billing_source == ("tokener" if latest_status == "active" else "legacy_message_credits")
    assert result.plan == CloudPlan.PROFESSIONAL
    assert result.remaining_credits is None
    assert not result.is_exhausted
    assert status.call_count == 3
    get_pool.assert_called_once()
    get_metering.assert_not_called()


@pytest.mark.parametrize("latest_status", ["none", "preparing"])
@pytest.mark.usefixtures("legacy_billing_profile")
def test_unconfirmed_billing_fence_is_not_masked(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], latest_status: str
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", Mock(return_value=latest_status))
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    get_pool = Mock(side_effect=LegacyCreditPoolManagedByTokenerError)
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", get_pool)
    with pytest.raises(LegacyCreditPoolManagedByTokenerError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    get_pool.assert_called_once()


@pytest.mark.usefixtures("legacy_billing_profile")
def test_unrelated_billing_outage_is_not_masked(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    status = Mock(return_value="preparing")
    monkeypatch.setattr("core.model_invocation_routing.migration_display_status", status)
    monkeypatch.setattr(
        gateways.BillingService, "get_info", Mock(return_value={"subscription": {"plan": "professional"}})
    )
    monkeypatch.setattr(gateways.CreditPoolService, "get_pool", Mock(side_effect=BillingUpstreamUnavailableError))
    with pytest.raises(BillingUpstreamUnavailableError):
        DeploymentWorkspaceFeatureGateway().get_effective_credit_pool("tenant")
    status.assert_called_once()

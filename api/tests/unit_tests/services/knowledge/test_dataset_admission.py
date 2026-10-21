from collections.abc import Callable
from dataclasses import dataclass, field

import pytest

from controllers.service_api.dataset.segment import DatasetChildChunkApi, DatasetSegmentApi, SegmentApi
from enums import CloudPlan, DeploymentEdition
from machinery.context import RequestContext
from services.entities.feature_entities import FeatureModel, KnowledgeRateLimitModel, VectorSpaceLimitationModel
from services.knowledge.admission.application import (
    DatasetAdmissionIdentityError,
    DatasetAdmissionPolicy,
    DatasetAdmissionScopeError,
    DatasetAdmissionService,
)
from services.knowledge.admission.limits import KnowledgeApiLimitsGateway, KnowledgeApiPaidPlanRequiredError
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.resource_scope import DatasetRef


@dataclass
class AdmissionStore:
    datasets: dict[DatasetRef, bool] = field(default_factory=lambda: {DatasetRef("workspace", "dataset"): True})
    bindings: set[str] = field(default_factory=set)
    status: str = "normal"
    owner: str | None = "owner"
    key_exists: bool = True
    scope_reads: int = 0
    limit_checks: list[tuple[str, bool, tuple[str, ...], bool]] = field(default_factory=list)

    def get_api_enabled(self, dataset_ref: DatasetRef) -> bool | None:
        return self.datasets.get(dataset_ref)

    def get_active_scope(self, workspace_id: str, api_key_id: str) -> frozenset[str] | None:
        assert api_key_id == "key"
        self.scope_reads += 1
        if not self.key_exists or workspace_id != "workspace":
            return None
        return frozenset(self.bindings)

    def active_owner_id(self, workspace_id: str) -> str | None:
        if workspace_id != "workspace" or self.status != "normal":
            return None
        return self.owner

    def check(
        self, workspace_id: str, *, rate_limit: bool, billing_resources: tuple[str, ...], require_paid_segments: bool
    ) -> None:
        self.limit_checks.append((workspace_id, rate_limit, billing_resources, require_paid_segments))


DEFAULT_POLICY = DatasetAdmissionPolicy()


class _UnusedRedis:
    def register_script(self, script: str) -> Callable[..., int]:
        assert "ZADD" in script

        def execute(**kwargs: object) -> int:
            del kwargs
            raise AssertionError("disabled rate limiting must not access Redis")

        return execute


class _UnusedRateLimitLogger:
    def record_knowledge_rate_limit(self, tenant_id: str, subscription_plan: str) -> None:
        del tenant_id, subscription_plan
        raise AssertionError("disabled rate limiting must not write logs")


def _cloud_limits(plan: CloudPlan) -> KnowledgeApiLimitsGateway:
    features = FeatureModel()
    features.billing.subscription.plan = plan

    def get_features(workspace_id: str) -> FeatureModel:
        assert workspace_id == "workspace"
        return features

    def get_vector_space(workspace_id: str) -> VectorSpaceLimitationModel:
        assert workspace_id == "workspace"
        return VectorSpaceLimitationModel(size=0, limit=5)

    def get_knowledge_rate_limit(workspace_id: str) -> KnowledgeRateLimitModel:
        assert workspace_id == "workspace"
        return KnowledgeRateLimitModel()

    return KnowledgeApiLimitsGateway(
        redis=_UnusedRedis(),
        get_features=get_features,
        get_vector_space=get_vector_space,
        get_knowledge_rate_limit=get_knowledge_rate_limit,
        rate_limit_logs=_UnusedRateLimitLogger(),
        deployment_edition=DeploymentEdition.CLOUD,
    )


def admit(
    store: AdmissionStore,
    *,
    workspace_id: str | None = "workspace",
    dataset_id: str | None = "dataset",
    api_key_id: str | None = "key",
    resource_dataset_ids: frozenset[str] | None = None,
    policy: DatasetAdmissionPolicy = DEFAULT_POLICY,
) -> RequestContext:
    return DatasetAdmissionService(datasets=store, keys=store, workspaces=store, limits=store).admit(
        workspace_id=workspace_id,
        dataset_id=dataset_id,
        api_key_id=api_key_id,
        resource_dataset_ids=resource_dataset_ids,
        request_id="request",
        trace_id="trace",
        remote_ip="192.0.2.1",
        policy=policy,
    )


def test_admission_produces_stable_owner_context_and_applies_endpoint_policy() -> None:
    store = AdmissionStore()
    policy = DatasetAdmissionPolicy(rate_limit=True, billing_resources=("documents",), require_paid_segments=True)

    context = admit(store, policy=policy)

    assert context.account_id == "owner"
    assert context.active_workspace_id == "workspace"
    assert (context.request_id, context.trace_id, context.remote_ip) == ("request", "trace", "192.0.2.1")
    assert store.limit_checks == [("workspace", True, ("documents",), True)]


@pytest.mark.parametrize("dataset_id", [None, "other-dataset"])
def test_bound_key_cannot_call_unscoped_or_other_dataset_endpoints(dataset_id: str | None) -> None:
    store = AdmissionStore(bindings={"dataset"})

    with pytest.raises(DatasetAdmissionScopeError, match="not authorized"):
        admit(store, dataset_id=dataset_id)

    assert not store.limit_checks


def test_bindings_are_read_again_after_key_scope_changes() -> None:
    store = AdmissionStore()
    assert admit(store, dataset_id=None).active_workspace_id == "workspace"
    store.bindings = {"dataset"}

    with pytest.raises(DatasetAdmissionScopeError):
        admit(store, dataset_id=None)

    assert store.scope_reads == 2


@pytest.mark.parametrize("dataset_id", [None, "dataset"])
def test_revoked_key_is_rejected_even_when_cached_identity_is_still_valid(dataset_id: str | None) -> None:
    store = AdmissionStore(key_exists=False)

    with pytest.raises(DatasetAdmissionIdentityError, match="no longer exists"):
        admit(store, dataset_id=dataset_id)

    assert not store.limit_checks


def test_resource_token_uses_resolved_scope_without_reading_an_api_key() -> None:
    store = AdmissionStore(bindings={"other-dataset"})
    context = admit(store, api_key_id=None, resource_dataset_ids=frozenset({"dataset"}))
    assert context.account_id == "owner"
    assert context.resource_dataset_ids == frozenset({"dataset"})
    assert store.scope_reads == 0


def test_resource_token_scope_is_enforced_again_at_framework_neutral_admission() -> None:
    store = AdmissionStore()

    with pytest.raises(DatasetAdmissionScopeError, match="resource access token"):
        admit(store, api_key_id=None, resource_dataset_ids=frozenset({"other-dataset"}))

    assert not store.limit_checks


@pytest.mark.parametrize(
    ("api_enabled", "expected_error"),
    [
        (None, DatasetNotFoundError),
        (False, DatasetAdmissionScopeError),
    ],
)
def test_resource_token_still_requires_a_live_api_enabled_dataset(
    api_enabled: bool | None, expected_error: type[Exception]
) -> None:
    datasets = {} if api_enabled is None else {DatasetRef("workspace", "dataset"): api_enabled}
    store = AdmissionStore(datasets=datasets)

    with pytest.raises(expected_error):
        admit(store, api_key_id=None, resource_dataset_ids=frozenset({"dataset"}))

    assert not store.limit_checks


def test_key_cannot_be_reused_for_another_workspace() -> None:
    store = AdmissionStore()
    with pytest.raises(DatasetAdmissionIdentityError):
        admit(store, workspace_id="other-workspace")
    assert not store.limit_checks


def test_disabled_dataset_is_rejected() -> None:
    store = AdmissionStore(datasets={DatasetRef("workspace", "dataset"): False})
    with pytest.raises(DatasetAdmissionScopeError, match="not enabled"):
        admit(store)


@pytest.mark.parametrize("status", ["archive", "closed"])
def test_inactive_workspace_is_rejected(status: str) -> None:
    store = AdmissionStore(status=status)
    with pytest.raises(DatasetAdmissionIdentityError, match="Tenant does not exist"):
        admit(store)
    assert not store.limit_checks


def test_missing_owner_is_rejected() -> None:
    with pytest.raises(DatasetAdmissionIdentityError):
        admit(AdmissionStore(owner=None))


def test_child_chunk_patch_uses_real_admission_to_require_a_paid_cloud_plan() -> None:
    policy = DatasetChildChunkApi.patch.__dataset_admission_policy__
    assert policy.require_paid_segments is True
    store = AdmissionStore()

    sandbox_admission = DatasetAdmissionService(
        datasets=store,
        keys=store,
        workspaces=store,
        limits=_cloud_limits(CloudPlan.SANDBOX),
    )
    with pytest.raises(KnowledgeApiPaidPlanRequiredError, match="upgrade to a paid plan"):
        sandbox_admission.admit(
            workspace_id="workspace",
            api_key_id="key",
            resource_dataset_ids=None,
            dataset_id="dataset",
            request_id="request",
            trace_id=None,
            remote_ip=None,
            policy=policy,
        )

    paid_admission = DatasetAdmissionService(
        datasets=store,
        keys=store,
        workspaces=store,
        limits=_cloud_limits(CloudPlan.PROFESSIONAL),
    )
    context = paid_admission.admit(
        workspace_id="workspace",
        api_key_id="key",
        resource_dataset_ids=None,
        dataset_id="dataset",
        request_id="request",
        trace_id=None,
        remote_ip=None,
        policy=policy,
    )

    assert context.active_workspace_id == "workspace"


def test_existing_segment_update_is_allowed_for_sandbox_while_create_is_paid() -> None:
    store = AdmissionStore()
    admission = DatasetAdmissionService(
        datasets=store,
        keys=store,
        workspaces=store,
        limits=_cloud_limits(CloudPlan.SANDBOX),
    )

    update_context = admission.admit(
        workspace_id="workspace",
        api_key_id="key",
        resource_dataset_ids=None,
        dataset_id="dataset",
        request_id="update-request",
        trace_id=None,
        remote_ip=None,
        policy=DatasetSegmentApi.post.__dataset_admission_policy__,
    )

    assert update_context.active_workspace_id == "workspace"
    with pytest.raises(KnowledgeApiPaidPlanRequiredError, match="upgrade to a paid plan"):
        admission.admit(
            workspace_id="workspace",
            api_key_id="key",
            resource_dataset_ids=None,
            dataset_id="dataset",
            request_id="create-request",
            trace_id=None,
            remote_ip=None,
            policy=SegmentApi.post.__dataset_admission_policy__,
        )

from collections.abc import Callable
from dataclasses import dataclass, field

import pytest

from enums import CloudPlan, DeploymentEdition
from services.entities.feature_entities import FeatureModel, KnowledgeRateLimitModel, VectorSpaceLimitationModel
from services.knowledge.admission.limits import (
    KnowledgeApiLimitsGateway,
    KnowledgeApiPaidPlanRequiredError,
    KnowledgeApiRateLimitExceededError,
    KnowledgeApiResourceLimitExceededError,
    KnowledgeApiVectorSpaceUnavailableError,
)


@dataclass
class RecordingRedis:
    request_count: int = 1
    registered_scripts: list[str] = field(default_factory=list)
    script_calls: list[tuple[str, int, int, str]] = field(default_factory=list)

    def register_script(self, script: str) -> Callable[..., int]:
        self.registered_scripts.append(script)

        def execute(
            *,
            keys: list[str | bytes] | tuple[str | bytes, ...],
            args: list[object] | tuple[object, ...],
            client: object | None = None,
        ) -> int:
            assert client is None
            assert len(keys) == 1
            assert len(args) == 3
            key, current_time, window_ms, member = keys[0], args[0], args[1], args[2]
            assert isinstance(key, str)
            assert isinstance(current_time, int)
            assert isinstance(window_ms, int)
            assert isinstance(member, str)
            self.script_calls.append((key, current_time, window_ms, member))
            return self.request_count

        return execute


@dataclass
class MutableClock:
    current_time_ms: int = 1_700_000_060_000

    def __call__(self) -> int:
        return self.current_time_ms


@dataclass
class RecordingRateLimitLogger:
    events: list[tuple[str, str]] = field(default_factory=list)

    def record_knowledge_rate_limit(self, tenant_id: str, subscription_plan: str) -> None:
        self.events.append((tenant_id, subscription_plan))


@dataclass
class FeatureQueries:
    features: FeatureModel = field(default_factory=FeatureModel)
    vector_space: VectorSpaceLimitationModel = field(
        default_factory=lambda: VectorSpaceLimitationModel(size=0, limit=5)
    )
    rate_limit: KnowledgeRateLimitModel = field(default_factory=KnowledgeRateLimitModel)
    feature_calls: list[str] = field(default_factory=list)
    vector_space_calls: list[str] = field(default_factory=list)
    rate_limit_calls: list[str] = field(default_factory=list)

    def get_features(self, workspace_id: str) -> FeatureModel:
        self.feature_calls.append(workspace_id)
        return self.features

    def get_vector_space(self, workspace_id: str) -> VectorSpaceLimitationModel:
        self.vector_space_calls.append(workspace_id)
        return self.vector_space

    def get_knowledge_rate_limit(self, workspace_id: str) -> KnowledgeRateLimitModel:
        self.rate_limit_calls.append(workspace_id)
        return self.rate_limit


@dataclass
class LimitHarness:
    queries: FeatureQueries = field(default_factory=FeatureQueries)
    redis: RecordingRedis = field(default_factory=RecordingRedis)
    logs: RecordingRateLimitLogger = field(default_factory=RecordingRateLimitLogger)
    clock: MutableClock = field(default_factory=MutableClock)

    def gateway(self, deployment_edition: DeploymentEdition = DeploymentEdition.CLOUD) -> KnowledgeApiLimitsGateway:
        return KnowledgeApiLimitsGateway(
            redis=self.redis,
            get_features=self.queries.get_features,
            get_vector_space=self.queries.get_vector_space,
            get_knowledge_rate_limit=self.queries.get_knowledge_rate_limit,
            rate_limit_logs=self.logs,
            deployment_edition=deployment_edition,
            clock_ms=self.clock,
        )


def _check(
    gateway: KnowledgeApiLimitsGateway,
    *,
    rate_limit: bool = False,
    billing_resources: tuple[str, ...] = (),
    require_paid_segments: bool = False,
) -> None:
    gateway.check(
        "workspace-1",
        rate_limit=rate_limit,
        billing_resources=billing_resources,
        require_paid_segments=require_paid_segments,
    )


def test_non_cloud_deployment_skips_subscription_checks() -> None:
    harness = LimitHarness()
    harness.queries.features.documents_upload_quota.limit = 1
    harness.queries.features.documents_upload_quota.size = 1
    harness.queries.vector_space = VectorSpaceLimitationModel(size=5, limit=5)

    _check(
        harness.gateway(DeploymentEdition.COMMUNITY),
        billing_resources=("documents", "vector_space"),
        require_paid_segments=True,
    )

    assert harness.queries.feature_calls == []
    assert harness.queries.vector_space_calls == []


def test_vector_space_check_uses_dedicated_query() -> None:
    harness = LimitHarness()
    harness.queries.vector_space = VectorSpaceLimitationModel(size=4, limit=5)

    _check(harness.gateway(), billing_resources=("vector_space",))

    assert harness.queries.vector_space_calls == ["workspace-1"]
    assert harness.queries.feature_calls == []


def test_vector_space_capacity_is_rejected() -> None:
    harness = LimitHarness()
    harness.queries.vector_space = VectorSpaceLimitationModel(size=5, limit=5)

    with pytest.raises(KnowledgeApiResourceLimitExceededError) as exc_info:
        _check(harness.gateway(), billing_resources=("vector_space",))

    assert exc_info.value.resource == "vector_space"
    assert str(exc_info.value) == "The capacity of the vector space has reached the limit of your subscription."


def test_unknown_vector_space_is_temporarily_unavailable_for_sandbox() -> None:
    harness = LimitHarness()
    harness.queries.vector_space = VectorSpaceLimitationModel(size=0, limit=50, usage_unknown=True)
    harness.queries.features.billing.subscription.plan = CloudPlan.SANDBOX

    with pytest.raises(KnowledgeApiVectorSpaceUnavailableError, match="Please try again later"):
        _check(harness.gateway(), billing_resources=("vector_space",))

    assert harness.queries.feature_calls == ["workspace-1"]


@pytest.mark.parametrize("plan", [CloudPlan.PROFESSIONAL, CloudPlan.TEAM])
def test_unknown_vector_space_is_allowed_for_paid_plans(plan: CloudPlan) -> None:
    harness = LimitHarness()
    harness.queries.vector_space = VectorSpaceLimitationModel(size=0, limit=50, usage_unknown=True)
    harness.queries.features.billing.subscription.plan = plan

    _check(harness.gateway(), billing_resources=("vector_space",))

    assert harness.queries.feature_calls == ["workspace-1"]


def test_document_capacity_is_rejected() -> None:
    harness = LimitHarness()
    harness.queries.features.documents_upload_quota.limit = 50
    harness.queries.features.documents_upload_quota.size = 50

    with pytest.raises(KnowledgeApiResourceLimitExceededError) as exc_info:
        _check(harness.gateway(), billing_resources=("documents",))

    assert exc_info.value.resource == "documents"
    assert str(exc_info.value) == "The number of documents has reached the limit of your subscription."


def test_paid_segment_check_rejects_sandbox_and_reuses_loaded_features() -> None:
    harness = LimitHarness()
    harness.queries.features.billing.subscription.plan = CloudPlan.SANDBOX

    with pytest.raises(KnowledgeApiPaidPlanRequiredError, match="upgrade to a paid plan"):
        _check(
            harness.gateway(),
            billing_resources=("documents",),
            require_paid_segments=True,
        )

    assert harness.queries.feature_calls == ["workspace-1"]


def test_disabled_rate_limit_does_not_touch_redis() -> None:
    harness = LimitHarness()

    _check(harness.gateway(), rate_limit=True)

    assert harness.queries.rate_limit_calls == ["workspace-1"]
    assert harness.redis.script_calls == []


def test_rate_limit_calls_atomic_script_with_unique_member_and_window() -> None:
    harness = LimitHarness()
    harness.queries.rate_limit = KnowledgeRateLimitModel(enabled=True, limit=10, subscription_plan="pro")

    _check(harness.gateway(), rate_limit=True)

    assert len(harness.redis.registered_scripts) == 1
    script = harness.redis.registered_scripts[0]
    assert "ZREMRANGEBYSCORE" in script
    assert "ZADD" in script
    assert "PEXPIRE" in script
    assert "ZCARD" in script
    assert len(harness.redis.script_calls) == 1
    key, current_time, window_ms, member = harness.redis.script_calls[0]
    assert key == "rate_limit_workspace-1"
    assert current_time == 1_700_000_060_000
    assert window_ms == 60_000
    assert member.startswith("1700000060000:")
    assert harness.logs.events == []


def test_exceeded_rate_limit_is_logged_before_rejection() -> None:
    harness = LimitHarness()
    harness.queries.rate_limit = KnowledgeRateLimitModel(enabled=True, limit=10, subscription_plan="pro")
    harness.redis.request_count = 11

    with pytest.raises(KnowledgeApiRateLimitExceededError, match="request rate limit"):
        _check(harness.gateway(), rate_limit=True)

    assert harness.logs.events == [("workspace-1", "pro")]

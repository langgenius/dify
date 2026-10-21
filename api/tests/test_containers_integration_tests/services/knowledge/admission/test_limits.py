import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Barrier

import pytest

from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from services.entities.feature_entities import FeatureModel, KnowledgeRateLimitModel, VectorSpaceLimitationModel
from services.knowledge.admission.limits import (
    KnowledgeApiLimitsGateway,
    KnowledgeApiRateLimitExceededError,
)


@dataclass
class MutableClock:
    current_time_ms: int = 1_700_000_000_000

    def __call__(self) -> int:
        return self.current_time_ms


@dataclass
class RecordingRateLimitLogger:
    events: list[tuple[str, str]] = field(default_factory=list)

    def record_knowledge_rate_limit(self, tenant_id: str, subscription_plan: str) -> None:
        self.events.append((tenant_id, subscription_plan))


def _gateway(
    *,
    limit: int,
    clock: MutableClock,
    logs: RecordingRateLimitLogger,
) -> KnowledgeApiLimitsGateway:
    rate_limit = KnowledgeRateLimitModel(enabled=True, limit=limit, subscription_plan="pro")
    return KnowledgeApiLimitsGateway(
        redis=redis_client,
        get_features=lambda _workspace_id: FeatureModel(),
        get_vector_space=lambda _workspace_id: VectorSpaceLimitationModel(size=0, limit=0),
        get_knowledge_rate_limit=lambda _workspace_id: rate_limit,
        rate_limit_logs=logs,
        deployment_edition=DeploymentEdition.CLOUD,
        clock_ms=clock,
    )


def _check(gateway: KnowledgeApiLimitsGateway, workspace_id: str) -> None:
    gateway.check(
        workspace_id,
        rate_limit=True,
        billing_resources=(),
        require_paid_segments=False,
    )


@pytest.mark.usefixtures("flask_app_with_containers")
def test_same_millisecond_parallel_requests_are_counted_by_real_redis() -> None:
    workspace_id = f"rate-limit-concurrency-{uuid.uuid4().hex}"
    key = f"rate_limit_{workspace_id}"
    clock = MutableClock()
    logs = RecordingRateLimitLogger()
    gateway = _gateway(limit=25, clock=clock, logs=logs)
    ready = Barrier(64)

    def request_is_allowed(_: int) -> bool:
        ready.wait(timeout=30)
        try:
            _check(gateway, workspace_id)
        except KnowledgeApiRateLimitExceededError:
            return False
        return True

    try:
        with ThreadPoolExecutor(max_workers=64) as executor:
            results = list(executor.map(request_is_allowed, range(64)))

        assert sum(results) == 25
        assert redis_client.zcard(key) == 64
        assert 60_000 < redis_client.pttl(key) <= 120_000
        assert logs.events == [(workspace_id, "pro")] * 39
    finally:
        redis_client.delete(key)


@pytest.mark.usefixtures("flask_app_with_containers")
def test_real_redis_excludes_request_at_sliding_window_boundary() -> None:
    workspace_id = f"rate-limit-boundary-{uuid.uuid4().hex}"
    key = f"rate_limit_{workspace_id}"
    clock = MutableClock()
    logs = RecordingRateLimitLogger()
    gateway = _gateway(limit=2, clock=clock, logs=logs)
    window_start = clock.current_time_ms

    try:
        _check(gateway, workspace_id)
        clock.current_time_ms = window_start + 59_999
        _check(gateway, workspace_id)
        clock.current_time_ms = window_start + 60_000
        _check(gateway, workspace_id)

        assert redis_client.zcard(key) == 2
        assert 60_000 < redis_client.pttl(key) <= 120_000
        assert logs.events == []
    finally:
        redis_client.delete(key)

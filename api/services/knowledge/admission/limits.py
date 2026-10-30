"""Infrastructure gateway for Knowledge API subscription and rate limits."""

import secrets
import time
from collections.abc import Callable
from typing import Protocol

from enums import CloudPlan, DeploymentEdition
from services.entities.feature_entities import FeatureModel, KnowledgeRateLimitModel, VectorSpaceLimitationModel


class KnowledgeApiLimitsError(Exception):
    """Base error raised when a Knowledge API request fails a usage policy."""


class KnowledgeApiResourceLimitExceededError(KnowledgeApiLimitsError):
    """A subscription resource has reached its configured capacity."""

    _MESSAGES = {
        "members": "The number of members has reached the limit of your subscription.",
        "apps": "The number of apps has reached the limit of your subscription.",
        "documents": "The number of documents has reached the limit of your subscription.",
        "vector_space": "The capacity of the vector space has reached the limit of your subscription.",
    }

    def __init__(self, resource: str) -> None:
        try:
            message = self._MESSAGES[resource]
        except KeyError as error:
            raise ValueError(f"Unsupported Knowledge API billing resource: {resource}") from error
        self.resource = resource
        super().__init__(message)


class KnowledgeApiPaidPlanRequiredError(KnowledgeApiLimitsError):
    """The requested knowledge operation is unavailable on the Sandbox plan."""

    def __init__(self) -> None:
        super().__init__("To unlock this feature and elevate your Dify experience, please upgrade to a paid plan.")


class KnowledgeApiVectorSpaceUnavailableError(KnowledgeApiLimitsError):
    """Vector-space usage could not be verified for a Sandbox workspace."""

    def __init__(self) -> None:
        super().__init__("Unable to verify vector space usage right now. Please try again later.")


class KnowledgeApiRateLimitExceededError(KnowledgeApiLimitsError):
    """The workspace exceeded its Knowledge API requests-per-minute allowance."""

    def __init__(self) -> None:
        super().__init__("Sorry, you have reached the knowledge base request rate limit of your subscription.")


class KnowledgeRateLimitRedis(Protocol):
    """Redis operations required by the Knowledge API sliding window."""

    def register_script(self, script: str) -> Callable[..., int]: ...


_RECORD_RATE_LIMIT_REQUEST_LUA = """
    local current_time = tonumber(ARGV[1])
    local window_ms = tonumber(ARGV[2])
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', current_time - window_ms)
    redis.call('ZADD', KEYS[1], current_time, ARGV[3])
    redis.call('PEXPIRE', KEYS[1], window_ms * 2)
    return redis.call('ZCARD', KEYS[1])
"""


class KnowledgeRateLimitLogger(Protocol):
    """Persist subscription rate-limit events without exposing an ORM model."""

    def record_knowledge_rate_limit(self, tenant_id: str, subscription_plan: str) -> None: ...


class KnowledgeApiLimitsGateway:
    """Apply Knowledge API limits using explicitly supplied infrastructure dependencies."""

    _RATE_LIMIT_WINDOW_MS = 60_000

    def __init__(
        self,
        *,
        redis: KnowledgeRateLimitRedis,
        get_features: Callable[[str], FeatureModel],
        get_vector_space: Callable[[str], VectorSpaceLimitationModel],
        get_knowledge_rate_limit: Callable[[str], KnowledgeRateLimitModel],
        rate_limit_logs: KnowledgeRateLimitLogger,
        deployment_edition: DeploymentEdition,
        clock_ms: Callable[[], int] | None = None,
    ) -> None:
        self._get_features = get_features
        self._get_vector_space = get_vector_space
        self._get_knowledge_rate_limit = get_knowledge_rate_limit
        self._rate_limit_logs = rate_limit_logs
        self._deployment_edition = deployment_edition
        self._clock_ms = clock_ms or _current_time_ms
        self._record_rate_limit_request = redis.register_script(_RECORD_RATE_LIMIT_REQUEST_LUA)

    def check(
        self,
        workspace_id: str,
        *,
        rate_limit: bool,
        billing_resources: tuple[str, ...],
        require_paid_segments: bool,
    ) -> None:
        """Reject a request that exceeds any policy attached to its endpoint."""
        features: FeatureModel | None = None

        def workspace_features() -> FeatureModel:
            nonlocal features
            if features is None:
                features = self._get_features(workspace_id)
            return features

        if self._deployment_edition == DeploymentEdition.CLOUD:
            for resource in billing_resources:
                if resource == "vector_space":
                    self._check_vector_space(workspace_id, workspace_features)
                else:
                    self._check_billing_resource(resource, workspace_features())

            if require_paid_segments:
                plan = workspace_features().billing.subscription.plan
                if plan == CloudPlan.SANDBOX:
                    raise KnowledgeApiPaidPlanRequiredError

        if rate_limit:
            self._check_rate_limit(workspace_id)

    def _check_vector_space(
        self,
        workspace_id: str,
        get_features: Callable[[], FeatureModel],
    ) -> None:
        vector_space = self._get_vector_space(workspace_id)
        if vector_space.usage_unknown:
            plan = get_features().billing.subscription.plan
            if plan == CloudPlan.SANDBOX:
                raise KnowledgeApiVectorSpaceUnavailableError

        if 0 < vector_space.limit <= vector_space.size:
            raise KnowledgeApiResourceLimitExceededError("vector_space")

    @staticmethod
    def _check_billing_resource(resource: str, features: FeatureModel) -> None:
        match resource:
            case "members":
                limitation = features.members
            case "apps":
                limitation = features.apps
            case "documents":
                limitation = features.documents_upload_quota
            case _:
                raise ValueError(f"Unsupported Knowledge API billing resource: {resource}")

        if 0 < limitation.limit <= limitation.size:
            raise KnowledgeApiResourceLimitExceededError(resource)

    def _check_rate_limit(self, workspace_id: str) -> None:
        limit = self._get_knowledge_rate_limit(workspace_id)
        if not limit.enabled:
            return

        current_time = self._clock_ms()
        key = f"rate_limit_{workspace_id}"
        request_count = int(
            self._record_rate_limit_request(
                keys=[key],
                args=[current_time, self._RATE_LIMIT_WINDOW_MS, _new_rate_limit_member(current_time)],
            )
        )
        if request_count <= limit.limit:
            return

        self._rate_limit_logs.record_knowledge_rate_limit(workspace_id, str(limit.subscription_plan))
        raise KnowledgeApiRateLimitExceededError


def _current_time_ms() -> int:
    return int(time.time() * 1000)


def _new_rate_limit_member(current_time: int) -> str:
    return f"{current_time}:{secrets.token_urlsafe(12)}"

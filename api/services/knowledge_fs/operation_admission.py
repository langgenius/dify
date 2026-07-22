"""Weighted admission for BFF calls and browser-executed KnowledgeFS operations."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from typing import Literal, NamedTuple, Protocol, cast

from configs import dify_config
from extensions.ext_redis import redis_client
from services.billing_service import BillingService
from services.feature_service import FeatureService, KnowledgeRateLimitModel
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.observability import (
    KnowledgeFSOperationAdmissionMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS

logger = logging.getLogger(__name__)

_BILLING_FEATURE_KEY = "knowledge_fs_operations"
_RATE_LIMIT_WINDOW_MS = 60_000
_WEIGHTED_RATE_LIMIT_SCRIPT = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[2])
local current = redis.call('ZCARD', KEYS[1])
local requested = tonumber(ARGV[4])
if current + requested > tonumber(ARGV[3]) then
  return 0
end
for index = 1, requested do
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[5] .. ':' .. index)
end
redis.call('PEXPIRE', KEYS[1], 61000)
return 1
"""


class KnowledgeFSOperationRateLimitExceededError(RuntimeError):
    """The operation's weighted per-minute bucket is exhausted."""


class KnowledgeFSOperationQuotaExceededError(RuntimeError):
    """The billing service explicitly rejected an operation reservation."""


class KnowledgeFSOperationUsage(NamedTuple):
    tenant_id: str
    operation_id: str
    bucket: str
    billing_cost: int
    rate_limit_cost: int


class KnowledgeFSOperationChargePort(Protocol):
    def commit(self) -> None: ...

    def refund(self) -> None: ...


class KnowledgeFSOperationRateLimitPort(Protocol):
    def admit(self, usage: KnowledgeFSOperationUsage) -> None: ...


class KnowledgeFSOperationBillingPort(Protocol):
    def reserve(self, usage: KnowledgeFSOperationUsage) -> KnowledgeFSOperationChargePort: ...


class KnowledgeFSRateLimitAuditPort(Protocol):
    def record_rejection(self, usage: KnowledgeFSOperationUsage, *, subscription_plan: str) -> None: ...


class KnowledgeFSBillingGateway(Protocol):
    def quota_reserve(self, **kwargs: object) -> dict[str, object]: ...

    def quota_commit(self, **kwargs: object) -> dict[str, object]: ...

    def quota_release(self, **kwargs: object) -> dict[str, object]: ...


class KnowledgeFSRedisEvalPort(Protocol):
    def eval(self, *args: object) -> int: ...


class _NoopCharge:
    def commit(self) -> None:
        return

    def refund(self) -> None:
        return


class _DifyBillingCharge:
    def __init__(
        self,
        *,
        gateway: KnowledgeFSBillingGateway,
        usage: KnowledgeFSOperationUsage,
        reservation_id: str,
    ) -> None:
        self._gateway = gateway
        self._usage = usage
        self._reservation_id = reservation_id
        self._finalized = False

    def commit(self) -> None:
        if self._finalized:
            return
        self._finalized = True
        try:
            self._gateway.quota_commit(
                tenant_id=self._usage.tenant_id,
                feature_key=_BILLING_FEATURE_KEY,
                bucket=self._usage.bucket,
                reservation_id=self._reservation_id,
                actual_amount=self._usage.billing_cost,
                meta={"operation_id": self._usage.operation_id, "source": "knowledge_fs"},
            )
        except Exception:
            logger.exception(
                "KnowledgeFS billing commit failed for tenant_id=%s operation_id=%s",
                self._usage.tenant_id,
                self._usage.operation_id,
            )

    def refund(self) -> None:
        if self._finalized:
            return
        self._finalized = True
        try:
            self._gateway.quota_release(
                tenant_id=self._usage.tenant_id,
                feature_key=_BILLING_FEATURE_KEY,
                bucket=self._usage.bucket,
                reservation_id=self._reservation_id,
            )
        except Exception:
            logger.exception(
                "KnowledgeFS billing release failed for tenant_id=%s operation_id=%s",
                self._usage.tenant_id,
                self._usage.operation_id,
            )


class LoggingKnowledgeFSRateLimitAudit:
    def record_rejection(self, usage: KnowledgeFSOperationUsage, *, subscription_plan: str) -> None:
        logger.warning(
            "KnowledgeFS weighted rate limit rejected tenant_id=%s operation_id=%s bucket=%s cost=%s plan=%s",
            usage.tenant_id,
            usage.operation_id,
            usage.bucket,
            usage.rate_limit_cost,
            subscription_plan,
        )


class DifyKnowledgeFSWeightedRateLimitPort:
    """Consume weighted operation units atomically from one Redis bucket."""

    def __init__(
        self,
        *,
        redis: KnowledgeFSRedisEvalPort | None = None,
        audit: KnowledgeFSRateLimitAuditPort,
        rate_limit_lookup: Callable[[str], KnowledgeRateLimitModel] = FeatureService.get_knowledge_rate_limit,
        clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
        member_id: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        self._redis = redis or cast(KnowledgeFSRedisEvalPort, redis_client)
        self._audit = audit
        self._rate_limit_lookup = rate_limit_lookup
        self._clock_ms = clock_ms
        self._member_id = member_id

    def admit(self, usage: KnowledgeFSOperationUsage) -> None:
        rate_limit = self._rate_limit_lookup(usage.tenant_id)
        if not rate_limit.enabled:
            return
        now = self._clock_ms()
        accepted = self._redis.eval(
            _WEIGHTED_RATE_LIMIT_SCRIPT,
            1,
            f"knowledge_fs:rate_limit:{usage.tenant_id}:{usage.bucket}",
            now,
            now - _RATE_LIMIT_WINDOW_MS,
            rate_limit.limit,
            usage.rate_limit_cost,
            self._member_id(),
        )
        if accepted == 1:
            return
        self._audit.record_rejection(usage, subscription_plan=rate_limit.subscription_plan)
        raise KnowledgeFSOperationRateLimitExceededError("KnowledgeFS operation rate limit exceeded")


class DifyKnowledgeFSBillingPort:
    """Reserve operation-specific billing units for the caller to commit or release."""

    def __init__(
        self,
        *,
        gateway: KnowledgeFSBillingGateway | None = None,
        billing_enabled: Callable[[], bool] = lambda: dify_config.BILLING_ENABLED,
        request_id: Callable[[], str] = lambda: str(uuid.uuid4()),
    ) -> None:
        self._gateway = gateway or cast(KnowledgeFSBillingGateway, BillingService)
        self._billing_enabled = billing_enabled
        self._request_id = request_id

    def reserve(self, usage: KnowledgeFSOperationUsage) -> KnowledgeFSOperationChargePort:
        if not self._billing_enabled():
            return _NoopCharge()
        try:
            result = self._gateway.quota_reserve(
                tenant_id=usage.tenant_id,
                feature_key=_BILLING_FEATURE_KEY,
                bucket=usage.bucket,
                request_id=self._request_id(),
                amount=usage.billing_cost,
                meta={"operation_id": usage.operation_id, "source": "knowledge_fs"},
            )
        except Exception:
            logger.exception(
                "KnowledgeFS billing reservation unavailable for tenant_id=%s operation_id=%s; allowing request",
                usage.tenant_id,
                usage.operation_id,
            )
            return _NoopCharge()
        reservation_id = result.get("reservation_id")
        if not isinstance(reservation_id, str) or not reservation_id:
            raise KnowledgeFSOperationQuotaExceededError("KnowledgeFS operation quota exceeded")
        return _DifyBillingCharge(gateway=self._gateway, usage=usage, reservation_id=reservation_id)


class KnowledgeFSOperationAdmissionService:
    def __init__(
        self,
        *,
        rate_limit: KnowledgeFSOperationRateLimitPort,
        billing: KnowledgeFSOperationBillingPort,
    ) -> None:
        self._rate_limit = rate_limit
        self._billing = billing

    def reserve(self, *, tenant_id: str, operation_id: str) -> KnowledgeFSOperationChargePort:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        usage = KnowledgeFSOperationUsage(
            tenant_id=tenant_id,
            operation_id=operation_id,
            bucket=operation.rate_limit_bucket,
            billing_cost=operation.billing_cost,
            rate_limit_cost=operation.rate_limit_cost,
        )
        self._rate_limit.admit(usage)
        return self._billing.reserve(usage)


class KnowledgeFSDirectCapabilityBrokerPort(Protocol):
    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability: ...

    def issue_service(
        self,
        *,
        profile: KnowledgeFSServiceCredentialProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability: ...


class KnowledgeFSDirectOperationAdmissionService:
    """Admit browser-executed operations at the Dify Capability issuance boundary.

    A successful Capability issuance is the only outcome Dify can observe before the browser
    talks to KnowledgeFS, so it commits the operation charge immediately. Issuance failures
    release the reservation. Controllers must treat alternative endpoints for the same manifest
    operation as separate entry points and must never chain them for one user action.
    """

    _admission: KnowledgeFSOperationAdmissionService
    _broker: KnowledgeFSDirectCapabilityBrokerPort
    _metrics: KnowledgeFSOperationalMetricsPort

    def __init__(
        self,
        *,
        admission: KnowledgeFSOperationAdmissionService,
        broker: KnowledgeFSDirectCapabilityBrokerPort,
        metrics: KnowledgeFSOperationalMetricsPort | None = None,
    ) -> None:
        self._admission = admission
        self._broker = broker
        self._metrics = metrics or get_knowledge_fs_operational_metrics()

    def issue_interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        return self._issue(
            tenant_id=tenant_id,
            operation_id=operation_id,
            issue=lambda: self._broker.issue_interactive(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                operation_id=operation_id,
                resource_id=resource_id,
                trace_id=trace_id,
            ),
        )

    def issue_service(
        self,
        *,
        profile: KnowledgeFSServiceCredentialProfile,
        operation_id: str,
        resource_id: str | None = None,
        trace_id: str | None = None,
    ) -> KnowledgeFSIssuedProductCapability:
        return self._issue(
            tenant_id=profile.tenant_id,
            operation_id=operation_id,
            issue=lambda: self._broker.issue_service(
                profile=profile,
                operation_id=operation_id,
                resource_id=resource_id,
                trace_id=trace_id,
            ),
        )

    def _issue(
        self,
        *,
        tenant_id: str,
        operation_id: str,
        issue: Callable[[], KnowledgeFSIssuedProductCapability],
    ) -> KnowledgeFSIssuedProductCapability:
        bucket = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].rate_limit_bucket
        try:
            charge = self._admission.reserve(tenant_id=tenant_id, operation_id=operation_id)
        except BaseException:
            self._record_metric(operation_id, bucket=bucket, phase="reserve", outcome="failure")
            raise
        self._record_metric(operation_id, bucket=bucket, phase="reserve", outcome="success")
        try:
            issued = issue()
        except BaseException:
            try:
                charge.refund()
            except BaseException:
                self._record_metric(operation_id, bucket=bucket, phase="refund", outcome="failure")
                raise
            self._record_metric(operation_id, bucket=bucket, phase="refund", outcome="success")
            raise
        try:
            charge.commit()
        except BaseException:
            self._record_metric(operation_id, bucket=bucket, phase="commit", outcome="failure")
            raise
        self._record_metric(operation_id, bucket=bucket, phase="commit", outcome="success")
        return issued

    def _record_metric(
        self,
        operation_id: str,
        *,
        bucket: str,
        phase: Literal["commit", "refund", "reserve"],
        outcome: Literal["failure", "success"],
    ) -> None:
        try:
            self._metrics.record_operation_admission(
                KnowledgeFSOperationAdmissionMetric(operation_id, bucket, phase, outcome)
            )
        except Exception:
            logger.warning("KnowledgeFS direct-operation admission metric export failed", exc_info=True)


__all__ = [
    "DifyKnowledgeFSBillingPort",
    "DifyKnowledgeFSWeightedRateLimitPort",
    "KnowledgeFSDirectOperationAdmissionService",
    "KnowledgeFSOperationAdmissionService",
    "KnowledgeFSOperationChargePort",
    "KnowledgeFSOperationQuotaExceededError",
    "KnowledgeFSOperationRateLimitExceededError",
    "KnowledgeFSOperationUsage",
    "LoggingKnowledgeFSRateLimitAudit",
]

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.knowledge_fs.operation_admission import (
    DifyKnowledgeFSBillingPort,
    DifyKnowledgeFSWeightedRateLimitPort,
    KnowledgeFSDirectOperationAdmissionService,
    KnowledgeFSOperationAdmissionService,
    KnowledgeFSOperationQuotaExceededError,
    KnowledgeFSOperationRateLimitExceededError,
    KnowledgeFSOperationUsage,
)


class RecordingCharge:
    def __init__(self) -> None:
        self.commits = 0
        self.refunds = 0

    def commit(self) -> None:
        self.commits += 1

    def refund(self) -> None:
        self.refunds += 1


class RecordingRateLimit:
    def __init__(self) -> None:
        self.usages: list[KnowledgeFSOperationUsage] = []

    def admit(self, usage: KnowledgeFSOperationUsage) -> None:
        self.usages.append(usage)


class RecordingBilling:
    def __init__(self, charge: RecordingCharge) -> None:
        self.charge = charge
        self.usages: list[KnowledgeFSOperationUsage] = []

    def reserve(self, usage: KnowledgeFSOperationUsage) -> RecordingCharge:
        self.usages.append(usage)
        return self.charge


class RecordingBroker:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.interactive_calls: list[dict[str, object]] = []
        self.service_calls: list[dict[str, object]] = []

    def issue_interactive(self, **kwargs):
        self.interactive_calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(token="interactive-capability")

    def issue_service(self, **kwargs):
        self.service_calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return SimpleNamespace(token="service-capability")


def test_operation_admission_consumes_registry_billing_and_rate_limit_mapping() -> None:
    rate_limit = RecordingRateLimit()
    charge = RecordingCharge()
    billing = RecordingBilling(charge)
    service = KnowledgeFSOperationAdmissionService(rate_limit=rate_limit, billing=billing)

    returned = service.reserve(tenant_id="tenant-1", operation_id="reindexDocuments")

    assert returned is charge
    assert rate_limit.usages == [
        KnowledgeFSOperationUsage(
            tenant_id="tenant-1",
            operation_id="reindexDocuments",
            bucket="import",
            billing_cost=20,
            rate_limit_cost=20,
        )
    ]
    assert billing.usages == rate_limit.usages


def test_direct_operation_admission_commits_at_successful_capability_issuance() -> None:
    rate_limit = RecordingRateLimit()
    charge = RecordingCharge()
    broker = RecordingBroker()
    admission = KnowledgeFSOperationAdmissionService(
        rate_limit=rate_limit,
        billing=RecordingBilling(charge),
    )
    metrics = MagicMock()
    service = KnowledgeFSDirectOperationAdmissionService(admission=admission, broker=broker, metrics=metrics)

    issued = service.issue_interactive(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        operation_id="createQuery",
    )

    assert issued.token == "interactive-capability"
    assert charge.commits == 1
    assert charge.refunds == 0
    assert broker.interactive_calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "createQuery",
            "resource_id": None,
            "trace_id": None,
        }
    ]
    assert rate_limit.usages == [KnowledgeFSOperationUsage("tenant-1", "createQuery", "direct", 20, 20)]
    assert [call.args[0] for call in metrics.record_operation_admission.call_args_list] == [
        ("createQuery", "direct", "reserve", "success"),
        ("createQuery", "direct", "commit", "success"),
    ]
    assert "tenant-1" not in str(metrics.record_operation_admission.call_args_list)


def test_direct_operation_admission_refunds_when_service_capability_issuance_fails() -> None:
    charge = RecordingCharge()
    broker = RecordingBroker(error=PermissionError("credential lost access"))
    admission = KnowledgeFSOperationAdmissionService(
        rate_limit=RecordingRateLimit(),
        billing=RecordingBilling(charge),
    )
    metrics = MagicMock()
    service = KnowledgeFSDirectOperationAdmissionService(admission=admission, broker=broker, metrics=metrics)
    profile = SimpleNamespace(tenant_id="tenant-1")

    with pytest.raises(PermissionError, match="lost access"):
        service.issue_service(profile=profile, operation_id="createQuery")

    assert charge.commits == 0
    assert charge.refunds == 1
    assert broker.service_calls == [
        {
            "profile": profile,
            "operation_id": "createQuery",
            "resource_id": None,
            "trace_id": None,
        }
    ]
    assert [call.args[0] for call in metrics.record_operation_admission.call_args_list] == [
        ("createQuery", "direct", "reserve", "success"),
        ("createQuery", "direct", "refund", "success"),
    ]


def test_direct_operation_admission_records_reserve_failure_without_tenant_labels() -> None:
    admission = MagicMock()
    admission.reserve.side_effect = KnowledgeFSOperationRateLimitExceededError("limited")
    metrics = MagicMock()
    service = KnowledgeFSDirectOperationAdmissionService(
        admission=admission,
        broker=RecordingBroker(),
        metrics=metrics,
    )

    with pytest.raises(KnowledgeFSOperationRateLimitExceededError):
        service.issue_interactive(
            tenant_id="tenant-secret",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="createQuery",
        )

    assert metrics.record_operation_admission.call_args.args[0] == (
        "createQuery",
        "direct",
        "reserve",
        "failure",
    )
    assert "tenant-secret" not in str(metrics.record_operation_admission.call_args_list)


class FakeRedis:
    def __init__(self, result: int) -> None:
        self.result = result
        self.calls: list[tuple[object, ...]] = []

    def eval(self, *args: object) -> int:
        self.calls.append(args)
        return self.result


class RecordingRateLimitAudit:
    def __init__(self) -> None:
        self.usages: list[tuple[KnowledgeFSOperationUsage, str]] = []

    def record_rejection(self, usage: KnowledgeFSOperationUsage, *, subscription_plan: str) -> None:
        self.usages.append((usage, subscription_plan))


def test_weighted_rate_limit_uses_bucket_and_cost_atomically() -> None:
    redis = FakeRedis(1)
    audit = RecordingRateLimitAudit()
    port = DifyKnowledgeFSWeightedRateLimitPort(
        redis=redis,
        audit=audit,
        rate_limit_lookup=lambda _tenant_id: SimpleNamespace(enabled=True, limit=30, subscription_plan="sandbox"),
        clock_ms=lambda: 1_000_000,
        member_id=lambda: "request-1",
    )
    usage = KnowledgeFSOperationUsage("tenant-1", "createResearchTask", "query", 25, 25)

    port.admit(usage)

    assert len(redis.calls) == 1
    _, key_count, key, now, window_start, limit, cost, member = redis.calls[0]
    assert key_count == 1
    assert key == "knowledge_fs:rate_limit:tenant-1:query"
    assert (now, window_start, limit, cost, member) == (1_000_000, 940_000, 30, 25, "request-1")
    assert audit.usages == []


def test_weighted_rate_limit_rejects_and_records_operation_without_external_io() -> None:
    redis = FakeRedis(0)
    audit = RecordingRateLimitAudit()
    port = DifyKnowledgeFSWeightedRateLimitPort(
        redis=redis,
        audit=audit,
        rate_limit_lookup=lambda _tenant_id: SimpleNamespace(enabled=True, limit=10, subscription_plan="sandbox"),
        clock_ms=lambda: 1_000_000,
        member_id=lambda: "request-1",
    )
    usage = KnowledgeFSOperationUsage("tenant-1", "reindexDocuments", "import", 20, 20)

    with pytest.raises(KnowledgeFSOperationRateLimitExceededError):
        port.admit(usage)

    assert audit.usages == [(usage, "sandbox")]


class FakeBillingGateway:
    def __init__(self, reservation_id: str | None = "reservation-1", *, fail: bool = False) -> None:
        self.reservation_id = reservation_id
        self.fail = fail
        self.calls: list[tuple[str, dict[str, object]]] = []

    def quota_reserve(self, **kwargs: object) -> dict[str, str]:
        self.calls.append(("reserve", kwargs))
        if self.fail:
            raise RuntimeError("billing unavailable")
        return {"reservation_id": self.reservation_id} if self.reservation_id else {}

    def quota_commit(self, **kwargs: object) -> dict[str, str]:
        self.calls.append(("commit", kwargs))
        return {"result": "success"}

    def quota_release(self, **kwargs: object) -> dict[str, str]:
        self.calls.append(("release", kwargs))
        return {"result": "success"}


def test_billing_reservation_commits_or_releases_exact_operation_cost() -> None:
    gateway = FakeBillingGateway()
    port = DifyKnowledgeFSBillingPort(
        gateway=gateway,
        billing_enabled=lambda: True,
        request_id=lambda: "request-1",
    )
    usage = KnowledgeFSOperationUsage("tenant-1", "createResearchTask", "query", 25, 25)

    committed = port.reserve(usage)
    committed.commit()
    committed.commit()
    released = port.reserve(usage)
    released.refund()
    released.refund()

    assert [kind for kind, _ in gateway.calls] == ["reserve", "commit", "reserve", "release"]
    assert gateway.calls[0][1] == {
        "amount": 25,
        "bucket": "query",
        "feature_key": "knowledge_fs_operations",
        "meta": {"operation_id": "createResearchTask", "source": "knowledge_fs"},
        "request_id": "request-1",
        "tenant_id": "tenant-1",
    }
    assert gateway.calls[1][1]["actual_amount"] == 25
    assert gateway.calls[1][1]["reservation_id"] == "reservation-1"
    assert gateway.calls[3][1]["reservation_id"] == "reservation-1"


def test_billing_explicit_exhaustion_fails_closed_but_transport_failure_fails_open() -> None:
    usage = KnowledgeFSOperationUsage("tenant-1", "getSettings", "read", 1, 1)
    exhausted = DifyKnowledgeFSBillingPort(
        gateway=FakeBillingGateway(reservation_id=None),
        billing_enabled=lambda: True,
    )
    unavailable = DifyKnowledgeFSBillingPort(
        gateway=FakeBillingGateway(fail=True),
        billing_enabled=lambda: True,
    )

    with pytest.raises(KnowledgeFSOperationQuotaExceededError):
        exhausted.reserve(usage)

    charge = unavailable.reserve(usage)
    charge.commit()
    charge.refund()

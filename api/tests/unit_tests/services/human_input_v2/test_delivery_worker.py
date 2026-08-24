from dataclasses import replace
from datetime import datetime

from core.human_input_v2.approval import (
    ApproverGrantRef,
    ClaimedDeliveryAttempt,
    DeliveryAttempt,
    DeliveryAttemptData,
    DeliveryEndpointRef,
    FormRef,
    ProtectedRenderedEmailRequest,
)
from core.human_input_v2.delivery_runtime import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcome,
    EmailProviderAdapterRegistry,
    HumanInputRenderedEmailDeliveryRuntime,
    ProviderCredential,
    RenderedEmailDeliveryRequest,
    ResolvedEmailChannelSnapshot,
    derive_idempotency_key,
    fingerprint_rendered_email,
)
from core.human_input_v2.entities import EmailProviderType, HumanInputDeliveryAttemptStatus
from core.human_input_v2.shared import (
    ApproverGrantId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    EmailProviderId,
    FormId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_v2.delivery_worker import HumanInputV2DeliveryWorker
from services.human_input_v2.notification_producer import serialize_rendered_email_request

_NOW = datetime(2026, 7, 31, 8)
_PROVIDER = EmailProviderType.RESEND


def _request() -> RenderedEmailDeliveryRequest:
    delivery_id = DeliveryAttemptId("attempt-1")
    return RenderedEmailDeliveryRequest(
        tenant_id=TenantId("workspace-1"),
        provider=_PROVIDER,
        delivery_id=delivery_id,
        recipient=NormalizedEmail("reviewer@example.com"),
        subject="Approve",
        html="<p>Approve</p>",
        idempotency_key=derive_idempotency_key(delivery_id),
    )


def _claim() -> ClaimedDeliveryAttempt:
    request = _request()
    endpoint_ref = DeliveryEndpointRef(
        ApproverGrantRef(
            FormRef(TenantId("workspace-1"), FormId("form-1")),
            ApproverGrantId("grant-1"),
        ),
        DeliveryEndpointId("endpoint-1"),
    )
    data = DeliveryAttemptData(
        protected_request=ProtectedRenderedEmailRequest("ciphertext"),
        payload_fingerprint=fingerprint_rendered_email(request),
        idempotency_key=request.idempotency_key,
    )
    attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-1"),
        endpoint_ref=endpoint_ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.SENDING,
        scheduled_at=_NOW,
        started_at=_NOW,
        finished_at=None,
        provider_message_id=None,
        failure_code=None,
        failure_reason=None,
        provider_response=data.to_mapping(),
        created_at=_NOW,
        updated_at=_NOW,
    )
    return ClaimedDeliveryAttempt(attempt, data)


class Repository:
    def __init__(self, claim):
        self.claim_value = claim
        self.completed = None
        self.requeued = None

    def claim(self, attempt_id, *, now):
        del now
        assert attempt_id == DeliveryAttemptId("attempt-1")
        return self.claim_value

    def bind_prepared(self, claim, *, snapshot, payload_fingerprint, now):
        del payload_fingerprint
        data = replace(claim.data, configuration_snapshot=snapshot)
        return ClaimedDeliveryAttempt(replace(claim.attempt, updated_at=now, provider_response=data.to_mapping()), data)

    def complete(self, claim, *, outcome, now):
        del claim, now
        self.completed = outcome
        return True

    def requeue(self, claim, *, outcome, scheduled_at, now):
        del claim, scheduled_at, now
        self.requeued = outcome
        return True


class Protector:
    def reveal(self, tenant_id, protected):
        del tenant_id
        assert protected == ProtectedRenderedEmailRequest("ciphertext")
        return serialize_rendered_email_request(_request())


class Resolver:
    def resolve(self, tenant_id, provider, *, expected=None):
        del tenant_id, provider, expected
        return ResolvedEmailChannelSnapshot(
            ConfigurationSnapshotIdentity(EmailProviderId("configuration-1"), _NOW),
            _PROVIDER,
            NormalizedEmail("sender@example.com"),
            "Dify",
            ProviderCredential("secret"),
        )


class Adapter:
    provider = EmailProviderType.RESEND

    def __init__(self, outcome):
        self.outcome = outcome

    def send(self, prepared):
        del prepared
        return self.outcome


def test_worker_claims_binds_snapshot_and_completes_outside_repository_calls() -> None:
    repository = Repository(_claim())
    runtime = HumanInputRenderedEmailDeliveryRuntime(
        Resolver(),
        EmailProviderAdapterRegistry((Adapter(DeliveryOutcome.accepted("message-1")),)),
    )
    worker = HumanInputV2DeliveryWorker(repository, Protector(), runtime, clock=lambda: _NOW)

    worker.deliver(DeliveryAttemptId("attempt-1"))

    assert repository.completed == DeliveryOutcome.accepted("message-1")
    assert repository.requeued is None


def test_worker_requeues_retryable_outcome_without_creating_a_new_attempt() -> None:
    repository = Repository(_claim())
    runtime = HumanInputRenderedEmailDeliveryRuntime(
        Resolver(),
        EmailProviderAdapterRegistry((Adapter(DeliveryOutcome.retryable("provider_timeout")),)),
    )
    worker = HumanInputV2DeliveryWorker(repository, Protector(), runtime, clock=lambda: _NOW)

    worker.deliver(DeliveryAttemptId("attempt-1"))

    assert repository.completed is None
    assert repository.requeued == DeliveryOutcome.retryable("provider_timeout")

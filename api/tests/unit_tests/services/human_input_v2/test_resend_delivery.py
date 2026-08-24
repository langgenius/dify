from datetime import datetime

from core.human_input_v2.delivery_runtime import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcomeStatus,
    PreparedRenderedEmailDelivery,
    ProviderCredential,
    RenderedEmailDeliveryRequest,
    ResolvedEmailChannelSnapshot,
    derive_idempotency_key,
    fingerprint_rendered_email,
)
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import (
    DeliveryAttemptId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_v2.resend_delivery import (
    HttpxResendTransport,
    ResendEmailProviderAdapter,
    ResendHTTPResult,
    ResendTransportError,
)

_NOW = datetime(2026, 7, 31, 8)
_PROVIDER = EmailProviderType.RESEND


def _prepared(token: object) -> PreparedRenderedEmailDelivery:
    delivery_id = DeliveryAttemptId("attempt-1")
    request = RenderedEmailDeliveryRequest(
        tenant_id=TenantId("workspace-1"),
        provider=_PROVIDER,
        delivery_id=delivery_id,
        recipient=NormalizedEmail("reviewer@example.com"),
        subject="Approve",
        html="<p>Approve</p>",
        idempotency_key=derive_idempotency_key(delivery_id),
    )
    snapshot = ResolvedEmailChannelSnapshot(
        identity=ConfigurationSnapshotIdentity(EmailProviderId("configuration-1"), _NOW),
        provider=_PROVIDER,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Dify",
        credential=ProviderCredential("secret-api-key"),
    )
    return PreparedRenderedEmailDelivery(request, snapshot, fingerprint_rendered_email(request), token)


class Transport:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.prepared = []

    def send(self, prepared):
        self.prepared.append(prepared)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def test_resend_retries_exact_prepared_value_and_returns_safe_receipt() -> None:
    prepared = _prepared(object())
    transport = Transport(
        (
            ResendTransportError("provider_timeout"),
            ResendHTTPResult(429, {"name": "rate_limit_exceeded"}, 0),
            ResendHTTPResult(200, {"id": "message-1"}, None),
        )
    )
    adapter = ResendEmailProviderAdapter(transport, sleeper=lambda _seconds: None)

    outcome = adapter.send(prepared)

    assert outcome.status is DeliveryOutcomeStatus.ACCEPTED
    assert outcome.receipt is not None
    assert outcome.receipt.provider_message_id == "message-1"
    assert transport.prepared == [prepared, prepared, prepared]
    assert "secret-api-key" not in repr(outcome)


def test_resend_classifies_idempotency_conflict_and_malformed_success_as_terminal() -> None:
    prepared = _prepared(object())
    conflict = ResendEmailProviderAdapter(
        Transport((ResendHTTPResult(409, {"name": "idempotency_key_in_use"}, None),))
    ).send(prepared)
    malformed = ResendEmailProviderAdapter(Transport((ResendHTTPResult(200, {}, None),))).send(prepared)

    assert conflict.status is DeliveryOutcomeStatus.TERMINAL_FAILURE
    assert conflict.failure is not None
    assert conflict.failure.code == "provider_idempotency_conflict"
    assert malformed.failure is not None
    assert malformed.failure.code == "provider_response_malformed"


def test_resend_classifies_quota_exhaustion_as_terminal() -> None:
    prepared = _prepared(object())

    outcome = ResendEmailProviderAdapter(
        Transport((ResendHTTPResult(429, {"name": "daily_quota_exceeded"}, None),))
    ).send(prepared)

    assert outcome.status is DeliveryOutcomeStatus.TERMINAL_FAILURE
    assert outcome.failure is not None
    assert outcome.failure.code == "provider_quota_exhausted"


def test_resend_transport_result_representation_hides_provider_payload() -> None:
    result = ResendHTTPResult(400, {"message": "reviewer@example.com"}, None)

    assert "reviewer@example.com" not in repr(result)


def test_httpx_transport_is_request_scoped_with_fixed_origin_deadline_and_idempotency() -> None:
    created = []

    class Response:
        status_code = 200
        headers = {}

        def json(self):
            return {"id": "message-1"}

    class Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.request = None
            created.append(self)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def post(self, path, *, json, headers):
            self.request = (path, json, headers)
            return Response()

    prepared = _prepared(object())
    transport = HttpxResendTransport(timeout_seconds=7, client_factory=Client)

    result = transport.send(prepared)

    assert result.status_code == 200
    assert len(created) == 1
    assert created[0].kwargs == {"base_url": "https://api.resend.com", "timeout": 7}
    assert created[0].request[0] == "/emails"
    assert created[0].request[2]["Idempotency-Key"] == prepared.request.idempotency_key

from datetime import datetime
from pathlib import Path

import pytest

from core.human_input_v2.channel_identity import ChannelKind, ChannelProvider, ChannelRef
from core.human_input_v2.channel_management import (
    ChannelKind as ManagementChannelKind,
)
from core.human_input_v2.channel_management import (
    ChannelProvider as ManagementChannelProvider,
)
from core.human_input_v2.channel_management import (
    ChannelRef as ManagementChannelRef,
)
from core.human_input_v2.delivery_runtime import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcome,
    DuplicateEmailProviderAdapterError,
    EmailProviderAdapterRegistry,
    HumanInputRenderedEmailDeliveryRuntime,
    ProviderCredential,
    RenderedEmailDeliveryRequest,
    ResolvedEmailChannelSnapshot,
    derive_idempotency_key,
    fingerprint_rendered_email,
)
from core.human_input_v2.shared import (
    DeliveryAttemptId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)

_NOW = datetime(2026, 7, 31, 8)
_CHANNEL = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)


def _request() -> RenderedEmailDeliveryRequest:
    delivery_id = DeliveryAttemptId("attempt-1")
    return RenderedEmailDeliveryRequest(
        tenant_id=TenantId("workspace-1"),
        channel=_CHANNEL,
        delivery_id=delivery_id,
        recipient=NormalizedEmail("Reviewer@Example.com"),
        subject="Sensitive subject",
        html="<p>Sensitive body</p>",
        text="Sensitive body",
        idempotency_key=derive_idempotency_key(delivery_id),
    )


def _snapshot() -> ResolvedEmailChannelSnapshot:
    return ResolvedEmailChannelSnapshot(
        identity=ConfigurationSnapshotIdentity(EmailProviderId("configuration-1"), _NOW),
        channel=_CHANNEL,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Dify",
        credential=ProviderCredential("secret-api-key"),
    )


def test_rendered_request_and_snapshot_representations_are_secret_safe() -> None:
    request = _request()
    snapshot = _snapshot()

    representation = repr((request, snapshot))

    assert "secret-api-key" not in representation
    assert "reviewer@example.com" not in representation.lower()
    assert "Sensitive subject" not in representation
    assert "Sensitive body" not in representation
    assert fingerprint_rendered_email(request) == fingerprint_rendered_email(_request())
    assert len(request.idempotency_key) <= 256


def test_rendered_request_rejects_non_email_and_incomplete_content() -> None:
    with pytest.raises(ValueError, match="Email channel"):
        RenderedEmailDeliveryRequest(
            tenant_id=TenantId("workspace-1"),
            channel=ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
            delivery_id=DeliveryAttemptId("attempt-1"),
            recipient=NormalizedEmail("reviewer@example.com"),
            subject="Subject",
            html="<p>Body</p>",
            idempotency_key="key",
        )

    with pytest.raises(ValueError, match="subject"):
        RenderedEmailDeliveryRequest(
            tenant_id=TenantId("workspace-1"),
            channel=_CHANNEL,
            delivery_id=DeliveryAttemptId("attempt-1"),
            recipient=NormalizedEmail("reviewer@example.com"),
            subject=" ",
            html="<p>Body</p>",
            idempotency_key="key",
        )


def test_registry_rejects_duplicate_provider_and_runtime_owns_prepared_values() -> None:
    class Resolver:
        def resolve(self, tenant_id, channel, *, expected=None):
            assert tenant_id == TenantId("workspace-1")
            assert channel == _CHANNEL
            assert expected is None
            return _snapshot()

    class Adapter:
        provider = ChannelProvider.RESEND

        def send(self, prepared):
            assert prepared.payload_fingerprint == fingerprint_rendered_email(prepared.request)
            return DeliveryOutcome.accepted("message-1")

    adapter = Adapter()
    with pytest.raises(DuplicateEmailProviderAdapterError):
        EmailProviderAdapterRegistry((adapter, adapter))

    runtime = HumanInputRenderedEmailDeliveryRuntime(Resolver(), EmailProviderAdapterRegistry((adapter,)))
    prepared = runtime.prepare(_request())

    assert runtime.send(prepared) == DeliveryOutcome.accepted("message-1")


def test_channel_management_uses_shared_channel_identity_compatibility_exports() -> None:
    assert ManagementChannelKind is ChannelKind
    assert ManagementChannelProvider is ChannelProvider
    assert ManagementChannelRef is ChannelRef


def test_runtime_core_has_no_framework_persistence_or_provider_sdk_imports() -> None:
    package = Path(__file__).parents[5] / "core" / "human_input_v2" / "delivery_runtime"
    source = "\n".join(path.read_text() for path in package.glob("*.py"))

    for forbidden in ("sqlalchemy", "flask", "celery", "models.", "resend", "httpx"):
        assert forbidden not in source

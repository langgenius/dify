import base64
import json
from datetime import datetime, timedelta

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    CanonicalSubjectKey,
    DeliveryAttemptData,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    FormRef,
    HumanInputForm,
    IMEndpointPlan,
    MatchedRecipientSource,
    RecipientSourceKind,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
)
from core.human_input_v2.entities import (
    EmailProviderType,
    HumanInputDeliveryAttemptStatus,
    HumanInputV2FormKind,
    IMProvider,
)
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    FormId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_v2.notification_producer import (
    EndpointAccessTokenIssuer,
    HumanInputV2NotificationProducer,
    deserialize_rendered_email_request,
    serialize_rendered_email_request,
)

_NOW = datetime(2026, 7, 31, 8)


class Identifiers:
    def __init__(self) -> None:
        self.grants = iter(("grant-1",))
        self.endpoints = iter(("endpoint-email", "endpoint-email-backup", "endpoint-im"))

    def new_grant_id(self):
        return ApproverGrantId(next(self.grants))

    def new_endpoint_id(self):
        return DeliveryEndpointId(next(self.endpoints))


class Repository:
    def __init__(self) -> None:
        self.creation = None

    def create_form(self, creation):
        self.creation = creation
        return creation.form


class Protector:
    def protect(self, tenant_id, serialized_request):
        from core.human_input_v2.approval import ProtectedRenderedEmailRequest

        assert tenant_id == TenantId("workspace-1")
        return ProtectedRenderedEmailRequest(base64.b64encode(serialized_request.encode()).decode())

    def reveal(self, tenant_id, protected):
        assert tenant_id == TenantId("workspace-1")
        return base64.b64decode(protected.ciphertext).decode()


def _creation(*, second_email: bool = False):
    email = NormalizedEmail("reviewer@example.com")
    approver = ResolvedApprover(
        subject=EmailAddressApprovalSubject(email),
        subject_key=CanonicalSubjectKey.for_email(email),
        matched_sources=(MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, 0, str(email)),),
        subject_snapshot=SubjectSnapshot("Reviewer", str(email)),
        endpoints=(
            EmailEndpointPlan(email),
            *((EmailEndpointPlan(NormalizedEmail("backup@example.com")),) if second_email else ()),
            IMEndpointPlan(
                integration_id=IntegrationId("integration-1"),
                provider=IMProvider.FEISHU,
                provider_tenant_id="tenant-key",
                identity_id=IMIdentityId("identity-1"),
                binding_id=None,
                provider_user_id="provider-user-1",
            ),
        ),
    )
    return HumanInputForm.create_from_plan(
        ref=FormRef(TenantId("workspace-1"), FormId("form-1")),
        app_id=AppId("app-1"),
        resolved_form=ResolvedForm(
            title="Review",
            blocks=(MarkdownText("Approve"),),
            user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
            legacy_form_content="Approve",
        ),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        workflow_pause_id="pause-1",
        node_execution_id="execution-1",
        plan=ResolvedApprovalPlan((approver,), (), None),
        identifier_factory=Identifiers(),
        now=_NOW,
    )


def test_producer_persists_one_protected_email_attempt_and_ignores_im() -> None:
    repository = Repository()
    protector = Protector()
    producer = HumanInputV2NotificationProducer(
        repository,
        protector,
        token_issuer=EndpointAccessTokenIssuer(lambda: "plaintext-form-token"),
        attempt_id_factory=lambda: "attempt-1",
        clock=lambda: _NOW,
    )

    produced = producer.create(
        _creation(),
        subject_template="Approve {{#node.value#}}",
        body_template="Please review {{#node.value#}}",
        render_template=lambda template: template.replace("{{#node.value#}}", "request"),
        build_form_url=lambda _tenant_id, token: f"https://example.com/human-input/{token}",
    )

    assert produced.attempt_ids == (DeliveryAttemptId("attempt-1"),)
    assert repository.creation is not None
    assert len(repository.creation.endpoints) == 2
    assert len(repository.creation.attempts) == 1
    email_endpoint = repository.creation.endpoints[0]
    assert email_endpoint.access_capability is not None
    assert email_endpoint.access_capability.token_hash != "plaintext-form-token"
    attempt = repository.creation.attempts[0]
    assert attempt.status is HumanInputDeliveryAttemptStatus.QUEUED
    assert "plaintext-form-token" not in repr(attempt)
    assert "reviewer@example.com" not in repr(attempt)
    data = attempt.data
    assert isinstance(data, DeliveryAttemptData)
    assert "plaintext-form-token" not in data.protected_request.ciphertext

    serialized = protector.reveal(TenantId("workspace-1"), data.protected_request)
    serialized_payload = json.loads(serialized)
    assert serialized_payload["tenant_id"] == "workspace-1"
    assert serialized_payload["provider"] == EmailProviderType.RESEND
    assert "channel" not in serialized_payload
    assert "workspace_id" not in serialized_payload
    request = deserialize_rendered_email_request(serialized)
    assert request.subject == "Approve request"
    assert "Please review request" in request.html
    assert "plaintext-form-token" in request.html
    assert request.delivery_id == "attempt-1"


def _serialized_rendered_email_request(owner: dict[str, str]) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            **owner,
            "provider": "resend",
            "delivery_id": "attempt-1",
            "recipient": "reviewer@example.com",
            "subject": "Approve request",
            "html": "<p>Please review</p>",
            "text": "Please review",
            "idempotency_key": "delivery-key",
        }
    )


def test_rendered_email_deserializer_accepts_only_tenant_id() -> None:
    request = deserialize_rendered_email_request(_serialized_rendered_email_request({"tenant_id": "tenant-1"}))

    assert request.tenant_id == "tenant-1"
    assert json.loads(serialize_rendered_email_request(request))["tenant_id"] == "tenant-1"


@pytest.mark.parametrize(
    "owner",
    [
        {"workspace_id": "tenant-1"},
        {"tenant_id": "tenant-1", "workspace_id": "legacy-tenant-1"},
        {},
    ],
)
def test_rendered_email_deserializer_rejects_noncanonical_owner(owner: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="protected rendered Email request is malformed"):
        deserialize_rendered_email_request(_serialized_rendered_email_request(owner))


def test_producer_isolates_one_endpoint_materialization_failure() -> None:
    repository = Repository()

    class FailingOnceProtector(Protector):
        def __init__(self) -> None:
            self.calls = 0

        def protect(self, tenant_id, serialized_request):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("protection unavailable")
            return super().protect(tenant_id, serialized_request)

    tokens = iter(("token-1", "token-2"))
    attempt_ids = iter(("attempt-1", "attempt-2"))
    producer = HumanInputV2NotificationProducer(
        repository,
        FailingOnceProtector(),
        token_issuer=EndpointAccessTokenIssuer(lambda: next(tokens)),
        attempt_id_factory=lambda: next(attempt_ids),
        clock=lambda: _NOW,
    )

    producer.create(
        _creation(second_email=True),
        subject_template="Approve",
        body_template="Please review",
        render_template=lambda template: template,
        build_form_url=lambda _tenant_id, token: f"https://example.com/{token}",
    )

    assert repository.creation is not None
    assert [attempt.status for attempt in repository.creation.attempts] == [
        HumanInputDeliveryAttemptStatus.FAILED,
        HumanInputDeliveryAttemptStatus.QUEUED,
    ]
    assert repository.creation.attempts[0].failure_code == "delivery_materialization_failed"

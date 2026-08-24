"""Create durable provider-ready Email attempts with Human Input v2 forms."""

from __future__ import annotations

import html
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from hashlib import sha256

from pydantic import NaiveDatetime

from core.helper import encrypter
from core.human_input_v2.approval import (
    DeliveryAttempt,
    DeliveryAttemptData,
    DeliveryEndpoint,
    EmailEndpointConfiguration,
    EndpointAccessCapability,
    FormCreation,
    FormRepository,
    HumanInputForm,
    ProtectedRenderedEmailRequest,
    RenderedEmailRequestProtector,
)
from core.human_input_v2.delivery_runtime import (
    RenderedEmailDeliveryRequest,
    derive_idempotency_key,
    fingerprint_rendered_email,
)
from core.human_input_v2.entities import EmailProviderType, HumanInputDeliveryAttemptStatus
from core.human_input_v2.shared import DeliveryAttemptId, NormalizedEmail, TenantId
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

_RENDERED_EMAIL_REQUEST_FIELDS = frozenset(
    {
        "schema_version",
        "tenant_id",
        "provider",
        "delivery_id",
        "recipient",
        "subject",
        "html",
        "text",
        "idempotency_key",
    }
)


@dataclass(frozen=True, slots=True)
class IssuedEndpointAccess:
    capability: EndpointAccessCapability
    plaintext_token: str = field(repr=False)


class EndpointAccessTokenIssuer:
    def __init__(self, token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(32)) -> None:
        self._token_factory = token_factory

    def issue(self, endpoint: DeliveryEndpoint) -> IssuedEndpointAccess:
        token = self._token_factory()
        if not token:
            raise ValueError("endpoint access token factory returned a blank token")
        return IssuedEndpointAccess(
            capability=EndpointAccessCapability(
                endpoint_ref=endpoint.ref,
                token_hash=sha256(token.encode()).hexdigest(),
            ),
            plaintext_token=token,
        )


class DifyRenderedEmailRequestProtector:
    """Use the workspace hybrid key to protect arbitrary rendered payload size."""

    def protect(self, tenant_id: TenantId, serialized_request: str) -> ProtectedRenderedEmailRequest:
        return ProtectedRenderedEmailRequest(encrypter.encrypt_token(str(tenant_id), serialized_request))

    def reveal(self, tenant_id: TenantId, protected: ProtectedRenderedEmailRequest) -> str:
        return encrypter.decrypt_token(str(tenant_id), protected.ciphertext)


@dataclass(frozen=True, slots=True)
class ProducedHumanInputV2Form:
    form: HumanInputForm
    attempt_ids: tuple[DeliveryAttemptId, ...]


class HumanInputV2NotificationProducer:
    """Enrich a resolved form snapshot and atomically persist its Email work."""

    def __init__(
        self,
        repository: FormRepository,
        protector: RenderedEmailRequestProtector,
        *,
        token_issuer: EndpointAccessTokenIssuer | None = None,
        attempt_id_factory: Callable[[], str] = lambda: str(uuidv7()),
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._repository = repository
        self._protector = protector
        self._token_issuer = token_issuer or EndpointAccessTokenIssuer()
        self._attempt_id_factory = attempt_id_factory
        self._clock = clock

    def create(
        self,
        creation: FormCreation,
        *,
        subject_template: str,
        body_template: str,
        render_template: Callable[[str], str],
        build_form_url: Callable[[TenantId, str], str],
    ) -> ProducedHumanInputV2Form:
        tenant_id = creation.form.ref.tenant_id

        endpoints: list[DeliveryEndpoint] = []
        attempts: list[DeliveryAttempt] = []
        now = self._clock()
        for endpoint in creation.endpoints:
            if not isinstance(endpoint.configuration, EmailEndpointConfiguration):
                endpoints.append(endpoint)
                continue
            delivery_id = DeliveryAttemptId(self._attempt_id_factory())
            try:
                issued = self._token_issuer.issue(endpoint)
                endpoint = replace(endpoint, access_capability=issued.capability, updated_at=now)
                rendered_subject = render_template(subject_template).strip()
                rendered_body = render_template(body_template)
                if not rendered_subject:
                    raise ValueError("rendered Email subject must not be blank")
                form_url = build_form_url(tenant_id, issued.plaintext_token)
                request = self._render_request(
                    tenant_id=tenant_id,
                    endpoint=endpoint,
                    delivery_id=delivery_id,
                    subject=rendered_subject,
                    body=rendered_body,
                    form_url=form_url,
                )
                protected = self._protector.protect(tenant_id, serialize_rendered_email_request(request))
                data = DeliveryAttemptData(
                    protected_request=protected,
                    payload_fingerprint=fingerprint_rendered_email(request),
                    idempotency_key=request.idempotency_key,
                )
                attempts.append(
                    DeliveryAttempt(
                        id=request.delivery_id,
                        endpoint_ref=endpoint.ref,
                        attempt_number=1,
                        status=HumanInputDeliveryAttemptStatus.QUEUED,
                        scheduled_at=now,
                        started_at=None,
                        finished_at=None,
                        provider_message_id=None,
                        failure_code=None,
                        failure_reason=None,
                        provider_response=data.to_mapping(),
                        created_at=now,
                        updated_at=now,
                    )
                )
            except Exception:
                attempts.append(
                    DeliveryAttempt(
                        id=delivery_id,
                        endpoint_ref=endpoint.ref,
                        attempt_number=1,
                        status=HumanInputDeliveryAttemptStatus.FAILED,
                        scheduled_at=now,
                        started_at=None,
                        finished_at=now,
                        provider_message_id=None,
                        failure_code="delivery_materialization_failed",
                        failure_reason=None,
                        provider_response={
                            "schema_version": 0,
                            "failure_code": "delivery_materialization_failed",
                        },
                        created_at=now,
                        updated_at=now,
                    )
                )
            endpoints.append(endpoint)
        enriched = FormCreation(
            form=creation.form,
            endpoints=tuple(endpoints),
            attempts=tuple(attempts),
        )
        persisted = self._repository.create_form(enriched)
        return ProducedHumanInputV2Form(persisted, tuple(attempt.id for attempt in attempts))

    def _render_request(
        self,
        *,
        tenant_id: TenantId,
        endpoint: DeliveryEndpoint,
        delivery_id: DeliveryAttemptId,
        subject: str,
        body: str,
        form_url: str,
    ) -> RenderedEmailDeliveryRequest:
        configuration = endpoint.configuration
        if not isinstance(configuration, EmailEndpointConfiguration):
            raise TypeError("Email rendering requires an Email endpoint")
        html_body = _render_standard_email_html(body, form_url)
        text_body = _render_standard_email_text(body, form_url)
        return RenderedEmailDeliveryRequest(
            tenant_id=tenant_id,
            provider=EmailProviderType.RESEND,
            delivery_id=delivery_id,
            recipient=configuration.email_address,
            subject=subject,
            html=html_body,
            text=text_body,
            idempotency_key=derive_idempotency_key(delivery_id),
        )


def serialize_rendered_email_request(request: RenderedEmailDeliveryRequest) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "tenant_id": str(request.tenant_id),
            "provider": request.provider.value,
            "delivery_id": str(request.delivery_id),
            "recipient": str(request.recipient),
            "subject": request.subject,
            "html": request.html,
            "text": request.text,
            "idempotency_key": request.idempotency_key,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def deserialize_rendered_email_request(serialized: str) -> RenderedEmailDeliveryRequest:
    try:
        value = json.loads(serialized)
        if not isinstance(value, dict) or set(value) != _RENDERED_EMAIL_REQUEST_FIELDS:
            raise ValueError
        if value["schema_version"] != 1:
            raise ValueError
        return RenderedEmailDeliveryRequest(
            tenant_id=TenantId(value["tenant_id"]),
            provider=EmailProviderType(value["provider"]),
            delivery_id=DeliveryAttemptId(value["delivery_id"]),
            recipient=NormalizedEmail(value["recipient"]),
            subject=value["subject"],
            html=value["html"],
            text=value["text"],
            idempotency_key=value["idempotency_key"],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("protected rendered Email request is malformed") from error


def _render_standard_email_html(body: str, form_url: str) -> str:
    escaped_body = html.escape(body).replace("\n", "<br>")
    escaped_url = html.escape(form_url, quote=True)
    return (
        "<!doctype html><html><body>"
        f"<div>{escaped_body}</div>"
        f'<p><a href="{escaped_url}">Open approval form</a></p>'
        f'<p>If the button does not work, open: <a href="{escaped_url}">{escaped_url}</a></p>'
        "</body></html>"
    )


def _render_standard_email_text(body: str, form_url: str) -> str:
    return f"{body}\n\nOpen approval form: {form_url}"


__all__ = [
    "DifyRenderedEmailRequestProtector",
    "EndpointAccessTokenIssuer",
    "HumanInputV2NotificationProducer",
    "IssuedEndpointAccess",
    "ProducedHumanInputV2Form",
    "deserialize_rendered_email_request",
    "serialize_rendered_email_request",
]

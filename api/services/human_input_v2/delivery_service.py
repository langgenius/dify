"""Stub for actual Human Input notification sending after initialization.

The runtime invokes this after the form service commits first initialization,
and waits for the recorded result before deciding whether delivery succeeded.
Existing-form reentry does not invoke this service.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import SecretStr
from sqlalchemy.orm import Session

from repositories.human_input_v2.delivery_attempt_repository import DeliveryAttempt
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.recipient_repository import Recipient


@dataclass(frozen=True, slots=True)
class ResolvedMessageTemplate:
    """Notification text resolved for initialization, not from variables on retry.

    The body retains the single Request URL slot for the delivery-specific URL.
    Actual approval content and actions come from Form.resolved_form instead.
    """

    subject: str = field(repr=False)
    body: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class RecipientDeliveryResult:
    """Results for one recipient, including its usable initiator entry if any.

    attempts contains only actual sends; skipped channels do not fabricate
    successful attempts. form_token is present only for a usable Current
    Initiator interaction surface, never for an Email or IM notification.
    """

    attempts: tuple[DeliveryAttempt, ...]
    form_token: SecretStr | None = field(repr=False)


class HumanInputDeliveryService:
    """Determine and execute the deliveries for one persisted recipient.

    Accept only detached, committed inputs. Provider I/O runs without an open
    database transaction; creating deliveries and recording attempts use this
    service's own short transactions.
    No caller-owned Session or transaction participates in this operation.
    """

    def __init__(self, *, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def deliver(
        self,
        *,
        form: Form,
        recipient: Recipient,
        message_template: ResolvedMessageTemplate,
    ) -> RecipientDeliveryResult:
        """Resolve, create, send, and record deliveries for this recipient.

        The runtime supplies a committed Form and its persisted Recipient.
        Establish their tenant/form ownership and current form/workflow
        eligibility. Read the recipient's current Contact and effective binding
        where applicable; a direct-email recipient does not resolve to a Contact.
        Recipient identity is the deduplication boundary. Do not suppress this
        recipient's deliveries because another recipient has the same endpoint.

        Determine available channels and delivery form inside this service.
        Account-backed Contacts use available IM and Email concurrently; External
        and direct-email recipients use Email. Prefer an established Current
        Initiator surface when available. For IM, inspect dynamic-card capability
        and assess the frozen ResolvedForm before choosing card or link. The
        existing assess contract performs no provider I/O. Choose authentication
        for the resulting approval entry; an IM link is not IM callback approval.

        Create each Delivery with its chosen target/authentication and generated
        token, persisting only the token hash. Commit before calling providers.
        Keep tokens local for sending and return only the usable Current Initiator
        token. Present that surface through the runtime without a provider call.
        Render Request URL from the matching delivery token; card content comes
        from the frozen form and link notification text from message_template.

        Send outside database transactions, then record each actual outcome in
        a short transaction on its original delivery. A skipped channel is not
        a successful attempt. Provider acceptance does not establish receipt.
        Return after committing the results; Runtime aggregates them across
        recipients and handles an already submitted/terminal form before deciding
        all-delivery failure. Do not log tokens or complete message text.

        TODO: Persist the chosen IM card/link form explicitly; current Delivery
        fields do not express it. This stub does not infer it from auth_type or
        hide it in provider response JSON. Model/Repo schema changes remain pending.
        TODO: Define recovery for provider acceptance followed by a crash before
        recording. The attempt repository cannot make this exactly-once, and
        ordinary existing-form reentry must not retry the send.
        """
        raise NotImplementedError

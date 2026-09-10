"""Business persistence contract limited to HumanInputRecipient rows."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2.shared.values import ContactId, NormalizedEmail, RecipientId, TenantId
from core.workflow.nodes.human_input_v2.entities import RecipientConfig


@dataclass(frozen=True, slots=True)
class ContactRecipientSubject:
    """A resolved Contact identity, independent of its delivery endpoints."""

    contact_id: ContactId


@dataclass(frozen=True, slots=True)
class EmailRecipientSubject:
    """A direct email recipient without a Contact identity."""

    email: NormalizedEmail


@dataclass(frozen=True, slots=True)
class EndUserRecipientSubject:
    """An EndUser whose app ownership has already been verified by the caller."""

    end_user_id: str


type RecipientSubject = ContactRecipientSubject | EmailRecipientSubject | EndUserRecipientSubject


@dataclass(frozen=True, slots=True)
class Recipient:
    """Persisted recipient independent of ORM lifetime and delivery channel.

    subject identifies a Contact, a direct email recipient, or an EndUser.
    name is captured at creation and is None for subjects without a name;
    it is never refreshed from a directory.
    sources preserves the original configurations for provenance only. Reading
    them does not resolve or refresh this recipient's identity.
    """

    id: RecipientId
    tenant_id: TenantId
    form_id: str
    subject: RecipientSubject
    sources: tuple[RecipientConfig, ...]
    name: str | None
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


@dataclass(frozen=True, slots=True)
class RecipientCreateParams:
    """One concrete subject produced by the caller's recipient resolution.

    subject and name are supplied explicitly; the repository must not derive
    them from sources. sources is an already-collected history
    of configurations that selected this subject, stored without interpretation.

    Selector evaluation, initiator resolution, Contact expansion, and source
    merging belong to the caller. Values are already validated and normalized
    at their ingress boundaries; this value object performs no normalization.
    """

    subject: RecipientSubject
    sources: tuple[RecipientConfig, ...]
    name: str | None


class RecipientRepository(Protocol):
    """Recipient operations scoped to one constructor-bound tenant and form.

    Every read and write includes both owner predicates. The caller establishes
    the form's tenant/app ownership before binding the repository. Implementations
    access only HumanInputRecipient, without looking up forms, contacts, EndUsers,
    deliveries, attempts, or submission records. A successful lookup establishes
    recipient membership in this form, not authentication of the current actor.

    Implementations map subject variants to the model's subject_type and
    subject_value columns and reconstruct the variants on reads. Callers never
    encode or interpret these persistence fields.

    Callers own the transaction so recipient creation can be atomic with form
    creation. Implementations must not begin, commit, roll back, or create
    savepoints in that transaction. The caller rolls back on write failure.
    Persist and restore the supplied source configurations as provenance only.
    Pydantic validation at the storage boundary checks their serialized shape;
    it must not evaluate selectors, resolve identities, or query directories.
    All timestamps use naive UTC.
    """

    def create_recipients(self, params: Sequence[RecipientCreateParams]) -> tuple[Recipient, ...]:
        """Persist resolved recipients for form creation and return them in input order.

        Inputs contain one entry per distinct subject, with all its sources
        already merged. Different subject variants never merge, and
        different Contacts never merge merely because they share an email address.

        Atomically create missing subjects with generated IDs and timestamps.
        Reuse existing recipients on retries, preserving their IDs, sources,
        names, and timestamps. Concurrent creation may raise a database write
        conflict; the caller must roll back and retry the whole transaction.
        The repository does not recover or retry a failed transaction. This does not
        replace the form's recipient set or remove recipients absent from params.
        Empty input returns an empty tuple. On failure, the caller rolls back
        the transaction so partial batch writes do not persist.
        The caller only invokes this during form initialization;
        delivery retries and workflow resume read the persisted recipients.
        """
        ...

    def list_recipients(self) -> tuple[Recipient, ...]:
        """Read frozen recipients for delivery planning, resume, or historical display.

        Return all recipients for the bound form in ascending ID order, or an
        empty tuple when none exist. Do not re-resolve configuration sources or
        refresh subject information from current directories.
        """
        ...

    def get_recipient(self, recipient_id: RecipientId) -> Recipient | None:
        """Read a delivery's candidate recipient or a recorded submitter.

        Return None when the recipient is missing or outside the bound tenant
        and form. Actor verification and submission acceptance belong to callers.
        """
        ...

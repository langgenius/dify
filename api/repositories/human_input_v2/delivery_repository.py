"""Persistence contract for frozen form delivery and access information."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, EmailStr, Field, NaiveDatetime

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.shared.values import RecipientId, TenantId


class SubmissionAuthType(StrEnum):
    # CONSOLE means that this delivery is authenticated with
    # console session. It requires an assoiciated Dify `Account`.
    CONSOLE = "console"

    # WEB_APP means that this delivery is authenticated with web app
    # session. It requires an assoiciated `Enduser`.
    #
    # Please note that service API also uses `WEB_APP` auth type.
    WEB_APP = "web_app"

    # IM means that this delivery should be authenticated by correponding
    # IM events. For example, the deliveried card should generate an IM callback /
    # streaming event. The Dify instance consumes the event and determines
    # whether it is a valid submission. It requires an associated IM user.
    IM = "im"

    # IM means that this delivery must be authenticated by send an OTP email
    # to the corresponding email address. This auth type has no assoicated Dify or IM
    # identity.
    EMAIL_OTP = "email_otp"


class DeliveryTargetType(StrEnum):
    IM_USER = "im_user"
    EMAIL = "email"
    INITIATOR = "initiator"


class IMUserTargetSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)

    type: Literal[DeliveryTargetType.IM_USER] = DeliveryTargetType.IM_USER

    im_provider: IMProvider
    im_tenant_id: str
    im_provider_user_id: str


class EmailTargetSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)

    type: Literal[DeliveryTargetType.EMAIL] = DeliveryTargetType.EMAIL

    email_address: EmailStr


class InitiatorSnapshot(BaseModel):
    """Delivery through the already-established initiator interaction surface."""

    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)

    type: Literal[DeliveryTargetType.INITIATOR] = DeliveryTargetType.INITIATOR


type TargetSnapshot = Annotated[
    IMUserTargetSnapshot | EmailTargetSnapshot | InitiatorSnapshot,
    Field(discriminator="type"),
]


@dataclass(frozen=True, slots=True)
class DeliveryCreateParams:
    """Resolved, validated access data; raw tokens and credentials stay with callers."""

    recipient_id: RecipientId
    token_hash: str
    auth_type: SubmissionAuthType
    target_snapshot: TargetSnapshot


@dataclass(frozen=True, slots=True)
class Delivery:
    """Frozen delivery snapshot, independent of ORM lifetime and current bindings."""

    id: str
    tenant_id: TenantId
    form_id: str
    recipient_id: RecipientId
    token_hash: str
    auth_type: SubmissionAuthType
    target_snapshot: TargetSnapshot
    created_at: NaiveDatetime
    updated_at: NaiveDatetime


class DeliveryRepository(Protocol):
    """Delivery creation and token-based lookup of frozen access information.

    The caller owns the transaction; implementations never commit or roll it
    back. Callers guarantee that the recipient exists and belongs to the supplied
    tenant and form; creation does not recheck membership. Token lookup establishes
    the candidate delivery's owner context from storage. Targets and authentication
    facts are frozen at creation; this repository does not resolve recipients,
    select endpoints, authenticate actors, generate tokens, or send messages.
    All timestamps are naive UTC.
    """

    def create_delivery(self, *, tenant_id: TenantId, form_id: str, params: DeliveryCreateParams) -> Delivery:
        """Create one delivery with generated ID and timestamps.

        The caller guarantees recipient existence and tenant/form membership.
        Each call creates a separate delivery; callers plan endpoint deduplication
        and reuse persisted deliveries for subsequent send attempts.
        """
        ...

    def get_delivery_by_token_hash(self, token_hash: str) -> Delivery | None:
        """Locate a candidate delivery by its exact hash without prior owner context.

        Missing hashes return None. Return the persisted tenant and form with
        the candidate so callers can perform subsequent owner-scoped checks.
        Ambiguous hashes, including matches across different owners, must fail
        instead of selecting an arbitrary recipient. Lookup alone does not
        authenticate an actor or check whether the form may still be submitted.
        """
        ...

"""Temporary email proof values; each challenge belongs to one delivery."""

from enum import StrEnum
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field


class EmailSubject(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["email"] = "email"
    email: str


class ExternalContactSubject(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["external_contact"] = "external_contact"
    contact_id: str
    email: str


type EmailOtpSubject = Annotated[EmailSubject | ExternalContactSubject, Field(discriminator="type")]


class EmailChallenge(EmailSubject):
    otp: str = Field(repr=False)


class ExternalContactChallenge(ExternalContactSubject):
    otp: str = Field(repr=False)


type EmailOtpChallenge = Annotated[EmailChallenge | ExternalContactChallenge, Field(discriminator="type")]


class VerificationStatus(StrEnum):
    VERIFIED = "verified"
    INVALID = "invalid"
    STALE = "stale"
    EXPIRED = "expired"


class EmailOtpRepository(Protocol):
    def create(self, delivery_id: str, token: str, challenge: EmailOtpChallenge) -> None: ...

    def verify(self, delivery_id: str, token: str, subject: EmailOtpSubject, otp: str) -> VerificationStatus: ...

    def remaining_seconds(self, delivery_id: str, token: str) -> int: ...

    def delete(self, delivery_id: str, token: str) -> None: ...

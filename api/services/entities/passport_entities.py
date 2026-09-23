"""Framework-neutral data contracts for web passport issuance."""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict


@dataclass(frozen=True, slots=True)
class WebAppRecord:
    site_id: str
    app_id: str
    tenant_id: str
    app_code: str


@dataclass(frozen=True, slots=True)
class EndUserRecord:
    id: str


@dataclass(frozen=True, slots=True)
class WebPassportEndUserResolution:
    app_active: bool
    end_user: EndUserRecord | None


@dataclass(frozen=True, slots=True)
class WebPassportRequest:
    app_code: str
    user_session_id: str | None
    access_token: str | None


@dataclass(frozen=True, slots=True)
class WebPassportResult:
    access_token: str


class WebAppLoginClaims(BaseModel):
    token_source: str | None = None
    user_id: str | None = None
    end_user_id: str | None = None
    session_id: str | None = None
    auth_type: str | None = None
    exp: int | None = None

    model_config = ConfigDict(extra="ignore")

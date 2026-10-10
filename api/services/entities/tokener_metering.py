"""Tokener metering data shared by billing adapters and workspace contracts."""

from typing import Annotated, Literal, NotRequired, TypedDict

from pydantic import Field

_UnsignedDecimalString = Annotated[str, Field(pattern=r"^\d+$")]
_CanonicalUnsignedDecimalString = Annotated[str, Field(pattern=r"^(0|[1-9]\d*)$")]
_SignedDecimalString = Annotated[str, Field(pattern=r"^-?\d+$")]
_IsoDateString = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class TokenerCurrentMonthAvailableMetering(TypedDict):
    status: Literal["available"]
    start_date: _IsoDateString
    end_date: _IsoDateString
    billed_usd_micro: _UnsignedDecimalString
    request_count: _UnsignedDecimalString


class TokenerCurrentMonthUnavailableMetering(TypedDict):
    status: Literal["unavailable"]
    start_date: _IsoDateString
    end_date: _IsoDateString
    error_code: Annotated[str, Field(pattern=r"^[a-z0-9_]{1,100}$")]


TokenerCurrentMonthMetering = TokenerCurrentMonthAvailableMetering | TokenerCurrentMonthUnavailableMetering


class TokenerAllowanceMetering(TypedDict):
    window_id: str
    source_ref: str
    amount_usd_micro: _CanonicalUnsignedDecimalString
    available_usd_micro: _CanonicalUnsignedDecimalString
    starts_at: str
    ends_at: str


class TokenerTenantMeteringResponse(TypedDict):
    tenant_id: str
    currency: Literal["USD"]
    available_usd_micro: _SignedDecimalString
    current_month: TokenerCurrentMonthMetering
    balance_generated_at: str
    usage_generated_at: NotRequired[str]
    allowance: NotRequired[TokenerAllowanceMetering | None]
    entitlement_status: NotRequired[Literal["active", "processing", "retrying", "failed"]]
    entitlement_error_code: NotRequired[Annotated[str, Field(pattern=r"^[a-z0-9_]{1,100}$")]]

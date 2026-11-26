"""Model billing cohorts shared by application contracts and persistence adapters."""

from enum import StrEnum


class ModelBillingSource(StrEnum):
    LEGACY_MESSAGE_CREDITS = "legacy_message_credits"
    TOKENER = "tokener"


class TokenerPlanKind(StrEnum):
    """Tokener's allowance class, independent of the Dify tier."""

    SANDBOX = "sandbox"
    PAID = "paid"

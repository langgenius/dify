"""Model billing cohorts shared by application contracts and persistence adapters."""

from enum import StrEnum


class ModelBillingSource(StrEnum):
    LEGACY_MESSAGE_CREDITS = "legacy_message_credits"
    TOKENER = "tokener"

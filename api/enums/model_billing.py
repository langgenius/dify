from enum import StrEnum


class ModelBillingSource(StrEnum):
    LEGACY_MESSAGE_CREDITS = "legacy_message_credits"
    TOKENER = "tokener"

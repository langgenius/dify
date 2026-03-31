from enum import StrEnum, auto


class QuotaType(StrEnum):
    """
    Supported quota types for tenant feature usage.
    """

    TRIGGER = auto()
    WORKFLOW = auto()
    UNLIMITED = auto()

    @property
    def billing_key(self) -> str:
        match self:
            case QuotaType.TRIGGER:
                return "trigger_event"
            case QuotaType.WORKFLOW:
                return "api_rate_limit"
            case _:
                raise ValueError(f"Invalid quota type: {self}")

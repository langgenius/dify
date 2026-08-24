from enum import StrEnum, auto


class CloudPlan(StrEnum):
    """
    Enum representing user plan types in the cloud platform.

    SANDBOX: Free/default plan with limited features
    PROFESSIONAL: Professional paid plan
    TEAM: Team collaboration paid plan
    """

    SANDBOX = auto()
    PROFESSIONAL = auto()
    TEAM = auto()

    @property
    def is_paid(self) -> bool:
        return self in (CloudPlan.PROFESSIONAL, CloudPlan.TEAM)

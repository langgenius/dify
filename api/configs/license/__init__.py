from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings


class LicenseStatus(StrEnum):
    NONE = "none"
    INACTIVE = "inactive"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    LOST = "lost"

class LicenseConfig(BaseSettings):
    LICENSE_STATUS: LicenseStatus = Field(
        description="license status",
        default=LicenseStatus.NONE,
    )

    LICENSE_EXPIRED_AT: str = Field(
        description="license expired at",
        default="",
    )

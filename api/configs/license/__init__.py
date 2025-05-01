from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings

class LicenseConfig(BaseSettings):
    LICENSE_STATUS: str = Field(
        description="license status",
        default="none",
    )

    LICENSE_EXPIRED_AT: str = Field(
        description="license expired at",
        default="",
    )

"""Configuration for malware scanning of uploaded files."""

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class FileScanConfig(BaseSettings):
    """Deployment-level switches for file malware scanning."""

    FILE_SCAN_ENABLED: bool = Field(
        default=False,
        description="Expose file malware scanning. Each resource still has to turn it on in its own settings.",
    )
    FILE_SCAN_CLAMAV_HOST: str = Field(
        default="",
        description="Host of a clamd instance offered to every workspace as the ClamAV scanner. Empty hides ClamAV.",
    )
    FILE_SCAN_CLAMAV_PORT: PositiveInt = Field(default=3310, description="TCP port of the clamd instance.")
    FILE_SCAN_REQUEST_TIMEOUT_SECONDS: PositiveInt = Field(
        default=300,
        ge=5,
        le=3600,
        description="Timeout in seconds for one request to a scanner, for every scanner type.",
    )
    FILE_SCAN_MAX_ATTEMPTS: PositiveInt = Field(
        default=3, ge=1, le=5, description="Attempts per file when a scanner is temporarily unreachable."
    )
    FILE_SCAN_CLEAN_VERDICT_TTL_HOURS: PositiveInt = Field(
        default=24, description="How long a clean verdict for the same file content and scanner is reused."
    )

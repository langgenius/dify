"""Public client country endpoint backed by Cloudflare request metadata."""

import re

from flask import request
from pydantic import BaseModel, Field

from controllers.fastopenapi import console_router

COUNTRY_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2}$")


class ClientCountryResponse(BaseModel):
    country: str | None = Field(
        default=None,
        description="Two-character Cloudflare country code for the current request, or null when unavailable.",
        examples=["CN"],
    )


def _extract_cloudflare_country() -> str | None:
    country = request.headers.get("CF-IPCountry", "").strip().upper()
    if not COUNTRY_CODE_PATTERN.fullmatch(country):
        return None
    return country


@console_router.get(
    "/client-country",
    response_model=ClientCountryResponse,
    tags=["console"],
)
def get_client_country() -> ClientCountryResponse:
    """Return the visitor country inferred by Cloudflare.

    NOTE: This endpoint is unauthenticated by design. It exposes only Cloudflare's
    country code for the current request and performs no tenant, account, or setup checks.
    """
    return ClientCountryResponse(country=_extract_cloudflare_country())

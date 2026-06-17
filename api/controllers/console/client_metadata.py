"""Public client metadata endpoint backed by Cloudflare request metadata."""

import re

from flask import request
from flask_restx import Resource
from pydantic import Field

from controllers.common.schema import JsonResponseWithStatus, register_response_schema_models
from fields.base import ResponseModel
from libs.helper import dump_response

from . import console_ns

COUNTRY_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2}$")


class ClientGeoMetadataResponse(ResponseModel):
    country_code: str | None = Field(
        default=None,
        description="Two-character Cloudflare country code for the current request, or null when unavailable.",
        examples=["CN"],
    )


class ClientMetadataResponse(ResponseModel):
    geo: ClientGeoMetadataResponse = Field(description="Geographic metadata inferred for the current request.")


register_response_schema_models(console_ns, ClientMetadataResponse)


def _extract_cloudflare_country_code() -> str | None:
    country_code = request.headers.get("CF-IPCountry", "").strip().upper()
    if not COUNTRY_CODE_PATTERN.fullmatch(country_code):
        return None
    return country_code


@console_ns.route("/client-metadata")
class ClientMetadataApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ClientMetadataResponse.__name__])
    def get(self) -> JsonResponseWithStatus:
        """Return client metadata inferred from edge request headers.

        NOTE: This endpoint is unauthenticated by design. It exposes only low-sensitivity
        metadata for the current request and performs no tenant, account, or setup checks.
        """
        return dump_response(
            ClientMetadataResponse,
            {"geo": {"country_code": _extract_cloudflare_country_code()}},
        ), 200

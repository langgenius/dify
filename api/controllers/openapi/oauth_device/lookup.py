"""GET /openapi/v1/oauth/device/lookup — pre-validate user_code from
the /device page before the user signs in. Public; user_code is
high-entropy + short-TTL, per-IP rate limit blocks enumeration.

The class is also registered on the legacy /v1/ namespace from
service_api/oauth.py until Phase F retires that mount.
"""
from __future__ import annotations

from flask_restx import Resource, reqparse

from controllers.openapi import openapi_ns
from extensions.ext_redis import redis_client
from libs.rate_limit import LIMIT_LOOKUP_PUBLIC, rate_limit
from services.oauth_device_flow import (
    DEVICE_FLOW_TTL_SECONDS,
    DeviceFlowRedis,
    DeviceFlowStatus,
)

_lookup_parser = reqparse.RequestParser()
_lookup_parser.add_argument("user_code", type=str, required=True, location="args")


@openapi_ns.route("/oauth/device/lookup")
class OAuthDeviceLookupApi(Resource):
    """Read-only — public for pre-validate before login. user_code is
    high-entropy + short-TTL; per-IP rate limit blocks enumeration.
    """

    @rate_limit(LIMIT_LOOKUP_PUBLIC)
    def get(self):
        args = _lookup_parser.parse_args()
        user_code = args["user_code"].strip().upper()

        store = DeviceFlowRedis(redis_client)
        found = store.load_by_user_code(user_code)
        if found is None:
            return {"valid": False, "expires_in_remaining": 0, "client_id": None}, 200

        _device_code, state = found
        if state.status is not DeviceFlowStatus.PENDING:
            return {"valid": False, "expires_in_remaining": 0, "client_id": state.client_id}, 200

        return {
            "valid": True,
            "expires_in_remaining": DEVICE_FLOW_TTL_SECONDS,
            "client_id": state.client_id,
        }, 200

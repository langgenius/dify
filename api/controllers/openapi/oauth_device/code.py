"""POST /openapi/v1/oauth/device/code — RFC 8628 device authorization request.

Public + per-IP rate-limited. The CLI starts a device flow here; the
returned `verification_uri` is what the user opens in a browser. The
class is also registered on the legacy /v1/ namespace from
service_api/oauth.py until Phase F retires that mount.
"""
from __future__ import annotations

from flask import request
from flask_restx import Resource, reqparse

from configs import dify_config
from controllers.openapi import openapi_ns
from extensions.ext_redis import redis_client
from libs.helper import extract_remote_ip
from libs.rate_limit import LIMIT_DEVICE_CODE_PER_IP, rate_limit
from services.oauth_device_flow import (
    DEFAULT_POLL_INTERVAL_SECONDS,
    DeviceFlowRedis,
)

_code_parser = reqparse.RequestParser()
_code_parser.add_argument("client_id", type=str, required=True, location="json")
_code_parser.add_argument("device_label", type=str, required=True, location="json")


@openapi_ns.route("/oauth/device/code")
class OAuthDeviceCodeApi(Resource):
    @rate_limit(LIMIT_DEVICE_CODE_PER_IP)
    def post(self):
        args = _code_parser.parse_args()
        client_id = args["client_id"]
        device_label = args["device_label"]

        if client_id not in dify_config.OPENAPI_KNOWN_CLIENT_IDS:
            return {"error": "unsupported_client"}, 400

        store = DeviceFlowRedis(redis_client)
        ip = extract_remote_ip(request)
        device_code, user_code, expires_in = store.start(client_id, device_label, created_ip=ip)

        return {
            "device_code": device_code,
            "user_code": user_code,
            "verification_uri": _verification_uri(),
            "expires_in": expires_in,
            "interval": DEFAULT_POLL_INTERVAL_SECONDS,
        }, 200


def _verification_uri() -> str:
    base = getattr(dify_config, "CONSOLE_WEB_URL", None)
    if base:
        return f"{base.rstrip('/')}/device"
    return f"{request.host_url.rstrip('/')}/device"

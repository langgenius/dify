"""Legacy /v1/* mounts for the OAuth bearer + device-flow endpoints.
Canonical handlers live in controllers/openapi/. This file just
re-registers them on the service_api_ns until Phase F retires the
legacy paths entirely.
"""
from __future__ import annotations

from controllers.openapi.account import AccountApi, AccountSessionsSelfApi
from controllers.openapi.oauth_device.code import OAuthDeviceCodeApi
from controllers.openapi.oauth_device.lookup import OAuthDeviceLookupApi
from controllers.openapi.oauth_device.token import OAuthDeviceTokenApi
from controllers.service_api import service_api_ns

# Legacy /v1/* mounts — handlers live in controllers/openapi/.
# Removed in Phase F.
service_api_ns.add_resource(OAuthDeviceCodeApi, "/oauth/device/code")
service_api_ns.add_resource(OAuthDeviceTokenApi, "/oauth/device/token")
service_api_ns.add_resource(OAuthDeviceLookupApi, "/oauth/device/lookup")
service_api_ns.add_resource(AccountApi, "/me")
service_api_ns.add_resource(AccountSessionsSelfApi, "/oauth/authorizations/self")

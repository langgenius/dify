"""Shared Connection vocabulary without persistence or transport dependencies."""

from enum import StrEnum


class ConnectionCredentialType(StrEnum):
    API_KEY = "api-key"
    OAUTH2 = "oauth2"


class ConnectionStatus(StrEnum):
    CONNECTED = "connected"
    RECONNECT_REQUIRED = "reconnect_required"
    INVALID = "invalid"


class OAuthClientSource(StrEnum):
    WORKSPACE = "workspace"
    PLATFORM = "platform"

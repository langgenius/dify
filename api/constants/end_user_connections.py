"""Shared Connection vocabulary without persistence or transport dependencies."""

from enum import StrEnum

END_USER_OAUTH_CONTEXT_PREFIX = "end-user."


class ConnectionCredentialType(StrEnum):
    API_KEY = "api-key"
    OAUTH2 = "oauth2"


class ConnectionCredentialStatus(StrEnum):
    """Last known credential lifecycle state, not readiness for a particular node.

    Keep the existing storage values. App-specific Client mismatches and unbinding
    must never be written back as a global credential state change.
    """

    CONNECTED = "connected"
    RECONNECT_REQUIRED = "reconnect_required"
    INVALID = "invalid"


class NodeConnectionStatus(StrEnum):
    """The current selection's effective status for one published Tool node."""

    CONNECTED = "connected"
    RECONNECT_REQUIRED = "reconnect_required"
    INVALID = "invalid"
    DISCONNECTED = "disconnected"


class OAuthClientSource(StrEnum):
    WORKSPACE = "workspace"
    PLATFORM = "platform"

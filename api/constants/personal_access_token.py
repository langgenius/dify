"""Explicit PAT admission domains; independent of OAuth scope names."""

from enum import StrEnum


class PersonalAccessTokenPolicy(StrEnum):
    RESOURCE_CALLS = "resource_calls"
    RESOURCE_DISCOVERY = "resource_discovery"
    WORKSPACE_OPERATIONS = "workspace_operations"
    WORKSPACE_DISCOVERY = "workspace_discovery"
    IDENTITY_DISCOVERY = "identity_discovery"

"""Native API definition identity and admission, without database queries or provider I/O.

One canonical projection binds the selected operation and encrypted credential
version. Reasoning may inspect the projection; only the native Tool owner checks
it against the definition it will execute, before credential decryption.
"""

from typing import Any

from core.tools.entities.tool_bundle import ApiToolBundle
from models.tools import ApiToolProvider
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest


def api_definition(provider_id: str, bundle: ApiToolBundle, credential_version: str) -> dict[str, Any]:
    """Accept a validated native bundle; return nonsecret facts bound to its account version."""
    return {
        "provider_id": provider_id,
        "bundle": bundle.model_dump(mode="json"),
        "credential_version": credential_version,
    }


def provider_definition(provider: ApiToolProvider, action: str) -> dict[str, Any] | None:
    """Project exactly one owned operation, or None for missing/ambiguous declarations."""
    matches = [tool for tool in provider.tools if tool.operation_id == action]
    if len(matches) != 1:
        return None
    return {
        **api_definition(provider.id, matches[0], canonical_digest(provider.credentials_str)),
        "account": provider.name,
    }


def admit_api_definition(provider: ApiToolProvider, action: str, expected: str) -> ApiToolBundle:
    """Before decryption, return exactly the approved operation or refuse without provider I/O."""
    try:
        definition = provider_definition(provider, action)
    except (ValueError, TypeError):
        definition = None
    if definition is None or canonical_digest(definition) != expected:
        raise BuilderExecutionPolicyError("api_tool_definition_stale")
    return ApiToolBundle.model_validate(definition["bundle"])

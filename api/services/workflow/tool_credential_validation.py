"""Runtime-aware workflow credential validation, separate from static query projections."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from domain.plugins.provider_id import normalize_tool_provider_id
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolProviderType
from services.workflow.tool_credentials import ToolCredentialConfig, ToolNodeSpec


@dataclass(frozen=True)
class ToolCredentialIssue:
    node_id: str
    path: tuple[str | int, ...]
    message: str


def _same_provider(data: Mapping[str, Any], target_data: Mapping[str, Any]) -> bool:
    """Compare node providers, preserving local builtin precedence; never load remote providers."""
    if data.get("provider_type") != target_data.get("provider_type"):
        return False
    provider = data.get("provider_id")
    target_provider = target_data.get("provider_id")
    if not isinstance(provider, str) or not provider or not isinstance(target_provider, str) or not target_provider:
        return False
    if provider == target_provider:
        return True

    if data.get("provider_type") == ToolProviderType.BUILT_IN:
        if _is_hardcoded_provider(provider) or _is_hardcoded_provider(target_provider):
            return False

    try:
        return normalize_tool_provider_id(provider) == normalize_tool_provider_id(target_provider)
    except ValueError:
        return False


def _is_hardcoded_provider(provider: str) -> bool:
    """Check local builtin identity; return False for unknown IDs without remote lookup."""
    from core.tools.tool_manager import ToolManager

    try:
        ToolManager.get_hardcoded_provider(provider)
    except KeyError:
        return False
    return True


def _configuration_issues(
    node_id: str, data: Mapping[str, Any], config: ToolCredentialConfig
) -> list[ToolCredentialIssue]:
    """Check parsed node configuration; return local policy violations without credential I/O."""
    issues: list[ToolCredentialIssue] = []
    if config.credential_source != "end_user" and config.end_user_auth is not None:
        issues.append(
            ToolCredentialIssue(node_id, ("end_user_auth",), "Only EndUser nodes can declare authentication settings.")
        )
    if config.credential_source != "reuse_node" and config.reuse_node_id is not None:
        issues.append(ToolCredentialIssue(node_id, ("reuse_node_id",), "Only reuse nodes can reference another node."))
    if config.credential_source == "workspace":
        return issues

    if config.credential_id is not None:
        issues.append(
            ToolCredentialIssue(node_id, ("credential_id",), "Only workspace nodes can bind a production credential.")
        )
    if data.get("provider_type") not in (ToolProviderType.BUILT_IN, ToolProviderType.PLUGIN):
        issues.append(
            ToolCredentialIssue(
                node_id,
                ("provider_type",),
                "EndUser authentication and reuse require a builtin or plugin tool provider.",
            )
        )
    for field in ("provider_id", "tool_name"):
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            issues.append(ToolCredentialIssue(node_id, (field,), "Field is required."))

    if config.credential_source == "reuse_node":
        if config.reuse_node_id is None or not config.reuse_node_id.strip():
            issues.append(ToolCredentialIssue(node_id, ("reuse_node_id",), "A reuse target is required."))
        if config.test_credential_id is not None:
            issues.append(
                ToolCredentialIssue(
                    node_id, ("test_credential_id",), "Reuse nodes inherit the target's test credential."
                )
            )
        return issues

    auth = config.end_user_auth
    if auth is None:
        issues.append(ToolCredentialIssue(node_id, ("end_user_auth",), "EndUser authentication is required."))
        return issues
    if not auth.allowed_credential_types:
        issues.append(
            ToolCredentialIssue(
                node_id,
                ("end_user_auth", "allowed_credential_types"),
                "At least one authentication method is required.",
            )
        )
    if auth.purpose is None or not auth.purpose.strip():
        issues.append(ToolCredentialIssue(node_id, ("end_user_auth", "purpose"), "Field is required."))
    if "oauth2" in (auth.allowed_credential_types or ()):
        if auth.oauth_client_type is None:
            issues.append(
                ToolCredentialIssue(
                    node_id, ("end_user_auth", "oauth_client_type"), "An OAuth client type is required."
                )
            )
    elif auth.oauth_client_type is not None:
        issues.append(
            ToolCredentialIssue(
                node_id, ("end_user_auth", "oauth_client_type"), "Only OAuth authentication can select a client type."
            )
        )
    return issues


def check_tool_credentials(graph: Mapping[str, Any], *, complete: bool) -> list[ToolCredentialIssue]:
    """Check supplied draft fields, optionally including completeness and graph-wide references.

    No credentials are loaded or validated remotely. Test credential availability is checked
    when a test uses it, so a deleted test reference cannot prevent production publication.
    """
    issues: list[ToolCredentialIssue] = []
    nodes = {
        node["id"]: node["data"]
        for node in graph.get("nodes", [])
        if isinstance(node, Mapping)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("data"), Mapping)
        and node.get("type") != "custom-note"
    }
    configs: dict[str, ToolCredentialConfig] = {}
    for node_id, data in nodes.items():
        if data.get("type") == BuiltinNodeTypes.TOOL:
            try:
                configs[node_id] = ToolCredentialConfig.model_validate(data)
            except ValidationError as error:
                issues.extend(
                    ToolCredentialIssue(node_id, problem["loc"], problem["msg"])
                    for problem in error.errors(include_url=False, include_input=False, include_context=False)
                )

    if not complete:
        return issues

    for node_id, config in configs.items():
        issues.extend(_configuration_issues(node_id, nodes[node_id], config))
    invalid_nodes = {issue.node_id for issue in issues}

    for node_id, config in configs.items():
        if node_id not in invalid_nodes and config.credential_source == "reuse_node":
            data = nodes[node_id]
            target_id = config.reuse_node_id
            target = configs.get(target_id) if target_id is not None else None
            target_data = nodes.get(target_id) if target_id is not None else None
            if target_id == node_id:
                message = "A node cannot reuse its own authentication."
            elif target_data is None:
                message = f"Reuse target {target_id!r} does not exist."
            elif target is None:
                message = f"Reuse target {target_id!r} must be a tool node with valid authentication settings."
            elif target.credential_source == "reuse_node":
                message = f"Reuse target {target_id!r} must configure authentication directly."
            elif target_id in invalid_nodes:
                message = f"Reuse target {target_id!r} has incomplete authentication settings."
            elif not _same_provider(data, target_data):
                message = f"Reuse target {target_id!r} must use the same provider type, plugin, and provider."
            else:
                message = None
            if message is not None:
                issues.append(ToolCredentialIssue(node_id, ("reuse_node_id",), message))
    return issues


def resolve_tool_credential_root(graph: Mapping[str, Any], node_id: str) -> tuple[str, ToolNodeSpec]:
    """Return this node's validated authentication root; raise ValueError for an invalid source."""
    nodes = {node["id"]: node for node in graph.get("nodes", []) if node.get("type") != "custom-note"}
    try:
        node = nodes[node_id]
        config = ToolCredentialConfig.model_validate(node["data"])
        root_id = config.reuse_node_id if config.credential_source == "reuse_node" else node_id
        if root_id is None:
            raise ValueError("Missing authentication source.")
        root = nodes[root_id]
        scope = [node] if root_id == node_id else [node, root]
        if check_tool_credentials({"nodes": scope}, complete=True):
            raise ValueError("Invalid authentication source.")
        return root_id, ToolNodeSpec.model_validate(root["data"])
    except (KeyError, TypeError, ValidationError):
        raise ValueError("Invalid authentication source.") from None

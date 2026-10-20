"""Dify-owned tool credential configuration, independent of Graphon's execution schema."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType


class EndUserAuthConfig(BaseModel):
    """Missing values represent an unfinished draft, not an executable configuration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    allowed_credential_types: list[Literal["api-key", "oauth2"]] | None = Field(default=None, max_length=2)
    purpose: str | None = Field(default=None, max_length=50)

    @field_validator("allowed_credential_types")
    @classmethod
    def validate_unique_credential_types(
        cls, value: list[Literal["api-key", "oauth2"]] | None
    ) -> list[Literal["api-key", "oauth2"]] | None:
        if value is not None and len(value) != len(set(value)):
            raise ValueError("Authentication methods must not contain duplicates.")
        return value


class ToolCredentialConfig(BaseModel):
    """Only references are persisted; personal Connection IDs belong to the user's App selection."""

    model_config = ConfigDict(frozen=True)

    # Reuse delegates the effective source and settings to the referenced node.
    credential_source: Literal["workspace", "end_user", "reuse_node"] = "workspace"
    credential_id: str | None = None
    end_user_auth: EndUserAuthConfig | None = None
    reuse_node_id: str | None = Field(default=None, min_length=1)
    test_credential_id: str | None = Field(default=None, min_length=1)


class ToolNodeSpec(ToolNodeData, ToolCredentialConfig):
    """The editor-facing schema includes Dify policy without changing Graphon's node model."""


@dataclass(frozen=True)
class ToolCredentialIssue:
    node_id: str
    path: tuple[str | int, ...]
    message: str


def _configuration_issues(
    node_id: str, data: Mapping[str, Any], config: ToolCredentialConfig
) -> list[ToolCredentialIssue]:
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
        if data.get("type") != BuiltinNodeTypes.TOOL:
            continue
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

    provider_methods: dict[tuple[str, str], set[str]] = {}
    for node_id, config in configs.items():
        if node_id in invalid_nodes:
            continue
        data = nodes[node_id]
        if config.credential_source == "end_user" and config.end_user_auth is not None:
            # Preserve the provider-wide compatibility policy while allowing either authentication method.
            methods: set[str] = set(config.end_user_auth.allowed_credential_types or ())
            key = (str(data["provider_type"]), str(data["provider_id"]))
            common = provider_methods.setdefault(key, methods)
            common.intersection_update(methods)
            if not common:
                issues.append(
                    ToolCredentialIssue(
                        node_id,
                        ("end_user_auth", "allowed_credential_types"),
                        "No authentication method is shared by all EndUser nodes for this provider.",
                    )
                )
        elif config.credential_source == "reuse_node":
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
            # The qualified provider ID identifies both the plugin and its provider.
            elif any(
                data.get(field) != target_data.get(field) for field in ("provider_type", "provider_id", "tool_name")
            ):
                message = f"Reuse target {target_id!r} must use the same plugin, provider, and tool."
            else:
                continue
            issues.append(ToolCredentialIssue(node_id, ("reuse_node_id",), message))
    return issues

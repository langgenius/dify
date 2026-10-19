"""Dify-owned tool credential configuration, independent of Graphon's execution schema."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType


class EndUserAuthConfig(BaseModel):
    """Missing values represent an unfinished draft, not an executable configuration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    credential_type: Literal["api-key", "oauth2"] | None = None
    selection_mode: Literal["independent", "reuse_node"] | None = None
    reuse_node_id: str | None = Field(default=None, min_length=1)
    purpose: str | None = Field(default=None, max_length=1000)


class ToolCredentialConfig(BaseModel):
    """Only references are persisted; personal Connection IDs belong to the user's App selection."""

    model_config = ConfigDict(frozen=True)

    credential_source: Literal["workspace", "end_user"] = "workspace"
    credential_id: str | None = None
    end_user_auth: EndUserAuthConfig | None = None
    test_credential_id: str | None = Field(default=None, min_length=1)


class ToolNodeSpec(ToolNodeData, ToolCredentialConfig):
    """The editor-facing schema includes Dify policy without changing Graphon's node model."""


@dataclass(frozen=True)
class ToolCredentialIssue:
    node_id: str
    path: tuple[str | int, ...]
    message: str


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

    reuse_targets: dict[str, str] = {}
    provider_types: dict[tuple[str, str], tuple[str, str]] = {}
    for node_id, config in configs.items():
        data = nodes[node_id]
        if config.credential_source == "workspace":
            if config.end_user_auth is not None:
                issues.append(
                    ToolCredentialIssue(
                        node_id, ("end_user_auth",), "Workspace nodes cannot declare EndUser authentication."
                    )
                )
            continue

        if config.credential_id is not None:
            issues.append(
                ToolCredentialIssue(
                    node_id, ("credential_id",), "EndUser nodes cannot bind a workspace credential for production."
                )
            )
        provider_type = data.get("provider_type")
        provider = data.get("provider_id")
        if provider_type not in (ToolProviderType.BUILT_IN, ToolProviderType.PLUGIN):
            issues.append(
                ToolCredentialIssue(
                    node_id, ("provider_type",), "EndUser authentication requires a builtin or plugin tool provider."
                )
            )
        if not isinstance(provider, str) or not provider.strip():
            issues.append(ToolCredentialIssue(node_id, ("provider_id",), "EndUser authentication requires a provider."))

        auth = config.end_user_auth
        if auth is None:
            issues.append(ToolCredentialIssue(node_id, ("end_user_auth",), "EndUser authentication is required."))
            continue
        for name in ("credential_type", "selection_mode", "purpose"):
            value = getattr(auth, name)
            if value is None or not value.strip():
                issues.append(ToolCredentialIssue(node_id, ("end_user_auth", name), "Field is required."))

        # A Provider has one active personal selection per App and user, even for independent nodes.
        if isinstance(provider, str) and auth.credential_type is not None:
            key = (str(provider_type), provider)
            previous = provider_types.setdefault(key, (node_id, auth.credential_type))
            if previous[1] != auth.credential_type:
                issues.append(
                    ToolCredentialIssue(
                        node_id,
                        ("end_user_auth", "credential_type"),
                        f"Authentication conflicts with node {previous[0]!r} for the same provider.",
                    )
                )

        if auth.selection_mode == "independent":
            if auth.reuse_node_id is not None:
                issues.append(
                    ToolCredentialIssue(
                        node_id,
                        ("end_user_auth", "reuse_node_id"),
                        "Independent selection cannot reference another node.",
                    )
                )
        elif auth.selection_mode == "reuse_node":
            target_id = auth.reuse_node_id
            if target_id is None:
                issues.append(
                    ToolCredentialIssue(node_id, ("end_user_auth", "reuse_node_id"), "A reuse target is required.")
                )
                continue
            target_data = nodes.get(target_id)
            target = configs.get(target_id)
            if target_data is None:
                message = f"Reuse target {target_id!r} does not exist."
            elif target is None or target.credential_source != "end_user":
                message = f"Reuse target {target_id!r} must be an EndUser tool node."
            elif (provider_type, provider) != (target_data.get("provider_type"), target_data.get("provider_id")):
                message = f"Reuse target {target_id!r} must use the same provider."
            elif target.end_user_auth is None or auth.credential_type != target.end_user_auth.credential_type:
                message = f"Reuse target {target_id!r} must use the same authentication method."
            else:
                reuse_targets[node_id] = target_id
                continue
            issues.append(ToolCredentialIssue(node_id, ("end_user_auth", "reuse_node_id"), message))

    visited: set[str] = set()
    for node_id in reuse_targets:
        path: dict[str, int] = {}
        current = node_id
        while current in reuse_targets and current not in visited:
            if current in path:
                cycle = list(path)[path[current] :]
                issues.extend(
                    ToolCredentialIssue(
                        member, ("end_user_auth", "reuse_node_id"), "Connection reuse must not contain a cycle."
                    )
                    for member in cycle
                )
                break
            path[current] = len(path)
            current = reuse_targets[current]
        visited.update(path)
    return issues

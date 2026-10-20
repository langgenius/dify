"""Published config asset reads under one active, claimed Agent operation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from dify_agent.adapters.native_testing.client import AgentPhysicalDispatchPayload

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_lineage import NativeAgentEndpointContext

if TYPE_CHECKING:
    from services.dify_builder.native_testing.agent_operations import AgentOperationService


def validate_config_read(
    *,
    context: NativeAgentEndpointContext,
    envelope: AgentPhysicalDispatchPayload,
    operations: AgentOperationService,
    tenant_id: str,
    user_id: str | None,
    agent_id: str,
    config_version_id: str,
    config_version_kind: str,
    source: dict[str, str] | None = None,
) -> None:
    """Revalidate the physical claim before the ordinary config service reads.

    Composition and asset names come from protected prepared state, never a
    Stub request. This consumes no second dispatch permission and grants no
    config writes or access to another Agent/snapshot.
    """
    current = operations.validate_claimed_shell(envelope=envelope)
    if current.ref != context.ref or current.config != context.config or current.native_test_profile != "confirmed":
        raise BuilderExecutionPolicyError("native_agent_config_mismatch")
    config = context.config.config
    composition = config.get("composition") if isinstance(config, dict) else None
    layers = composition.get("layers") if isinstance(composition, dict) else None
    if not isinstance(layers, list):
        raise BuilderExecutionPolicyError("native_agent_config_mismatch")

    def layer(name: str) -> dict[str, Any]:
        matches = [v.get("config") for v in layers if isinstance(v, dict) and v.get("name") == name]
        if len(matches) != 1 or not isinstance(matches[0], dict):
            raise BuilderExecutionPolicyError("native_agent_config_mismatch")
        return matches[0]

    execution, declared = layer("execution_context"), layer("config")
    version = declared.get("config_version")
    if (
        not isinstance(version, dict)
        or (tenant_id, user_id, agent_id, config_version_id, config_version_kind)
        != (
            execution.get("tenant_id"),
            execution.get("user_id"),
            declared.get("agent_id"),
            version.get("id"),
            "snapshot",
        )
        or version.get("kind") != "snapshot"
    ):
        raise BuilderExecutionPolicyError("native_agent_config_mismatch")
    if source is None:
        return
    kind, name = source.get("kind"), source.get("name")
    if kind not in {"file", "skill"}:
        raise BuilderExecutionPolicyError("native_agent_config_asset_unavailable")
    assets = declared.get("files" if kind == "file" else "skills", [])
    if not isinstance(assets, list) or not any(isinstance(v, dict) and v.get("name") == name for v in assets):
        raise BuilderExecutionPolicyError("native_agent_config_asset_unavailable")
    target = envelope.intent.target
    if isinstance(target, dict) and target.get("kind") in {"file", "skill"}:
        mentioned = declared.get("mentioned_file_names" if kind == "file" else "mentioned_skill_names", [])
        if target["kind"] != kind or name not in mentioned:
            raise BuilderExecutionPolicyError("native_agent_config_asset_unavailable")

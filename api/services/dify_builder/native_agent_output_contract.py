"""Public native Agent v2 output facts for generated workflow references.

Planner name promises are advisory. Actual selectors must match the native
node identity and its validated caller declarations; no snapshot, Soul prompt,
credentials or runtime lookup is needed here.
"""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from models.agent_config_entities import (
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
    effective_declared_outputs,
)


def declares_native_agent_output(data: Mapping[str, Any], variable: str) -> bool:
    """Resolve declared roots and explicitly declared object children only.

    System text and route-dependent switch come from the same public owner as
    native execution. Scalar and array outputs cannot be traversed as objects.
    Invalid caller declarations establish no usable contract, including system
    roots, so generation fails closed instead of accepting a partial schema.
    """
    if not is_dify_agent_node_data(data):
        return False
    try:
        job = WorkflowNodeJobConfig.model_validate(
            {
                "declared_outputs": data.get("agent_declared_outputs", []),
                "output_routes": data.get("agent_output_routes", {}),
            }
        )
    except ValidationError:
        return False
    parts = variable.split(".")
    outputs = effective_declared_outputs(job.declared_outputs, job.output_routes)
    declared: DeclaredOutputConfig | DeclaredOutputChildConfig | None = next(
        (output for output in outputs if output.name == parts[0]), None
    )
    for name in parts[1:]:
        if declared is None or declared.type != DeclaredOutputType.OBJECT:
            return False
        declared = next((child for child in declared.children if child.name == name), None)
    return declared is not None


def native_agent_config_errors(config: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    """Collect safe, independent native schema errors within builder correction.

    Legacy strategy configs retain their existing path. An explicit native
    marker, v2 or roster binding identifies a native config attempt, including
    an incomplete one. Wrapper type/title are supplied by graph assembly; no
    binding selection, authorization, coercion or schema repair happens here.
    """
    binding = config.get("agent_binding")
    roster_binding = isinstance(binding, Mapping) and binding.get("binding_type") == "roster_agent"
    if config.get("agent_node_kind") != "dify_agent" and str(config.get("version")) != "2" and not roster_binding:
        return ()
    errors: list[dict[str, Any]] = []
    validations = (
        (DifyAgentNodeData, {"title": "Workspace Agent", **config, "type": "agent"}),
        (
            WorkflowNodeJobConfig,
            {
                "declared_outputs": config.get("agent_declared_outputs", []),
                "output_routes": config.get("agent_output_routes", {}),
            },
        ),
    )
    for owner, payload in validations:
        try:
            owner.model_validate(payload)
        except ValidationError as exc:
            errors.extend(
                {"loc": list(error["loc"]), "type": error["type"]}
                for error in exc.errors(include_input=False, include_url=False)
            )
    return tuple(errors)

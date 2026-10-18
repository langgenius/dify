"""Public native Agent v2 output facts for generated workflow references.

Planner name promises are advisory. Actual selectors must match the native
node identity and its validated caller declarations; no snapshot, Soul prompt,
credentials or runtime lookup is needed here.
"""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
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

"""Retirement policy for bindings removed with a workflow revision."""

from collections.abc import Sequence

from enums.agent import WorkflowAgentBindingType
from services.workflow.contracts import DeletedWorkflowBinding


def inline_agent_retirement_candidates(bindings: Sequence[DeletedWorkflowBinding]) -> list[str]:
    return sorted(
        {
            binding.agent_id
            for binding in bindings
            if binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT and binding.agent_id
        }
    )

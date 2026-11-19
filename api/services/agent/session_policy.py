"""Map admitted node jobs and trusted binding state to the pure session policy."""

from typing import Any
from uuid import uuid4

from domain.agent.session_policy import AgentSessionPolicy, transition_agent_session_policy
from models.agent_config_entities import WorkflowNodeJobConfig


def merge_workflow_agent_session_policy(
    *,
    previous: WorkflowNodeJobConfig | None,
    node_job: WorkflowNodeJobConfig,
    requested_enabled: bool | None,
) -> WorkflowNodeJobConfig:
    """Return a node job whose generation comes only from persisted state.

    Preconditions: the caller holds the owning draft lock, supplies the trusted
    previous job (or None for a new binding), and validates the requested mode.
    None means the setting was omitted. Postconditions: client generation values
    are ignored; ordinary saves preserve mode and generation, actual mode changes
    rotate the generation. Other job fields are preserved and inputs are not mutated.
    """
    policy = transition_agent_session_policy(
        previous=(
            AgentSessionPolicy(enabled=previous.continue_agent_session, generation=previous.session_generation)
            if previous is not None
            else None
        ),
        requested_enabled=requested_enabled,
        new_generation=str(uuid4()),
    )
    return node_job.model_copy(
        update={"continue_agent_session": policy.enabled, "session_generation": policy.generation}
    )


def apply_workflow_agent_session_policy_to_node_data(
    *, node_data: dict[str, Any], node_job: WorkflowNodeJobConfig
) -> None:
    """Project a trusted saved job into the graph captured by future runs.

    Preconditions: node_data is the caller-owned Agent node dictionary and node_job
    has passed persistence policy. Postconditions: only the two session fields are
    updated; no other graph data or persisted session resource is changed.
    """
    node_data["continue_agent_session"] = node_job.continue_agent_session
    node_data["agent_session_generation"] = node_job.session_generation

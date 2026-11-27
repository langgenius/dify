"""A saved session policy never reactivates a generation after a mode change.

Legacy policies retain the empty generation until their mode changes. New
policies and mode changes consume a fresh identifier supplied by the caller;
ordinary saves preserve the trusted persisted generation.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AgentSessionPolicy:
    """Admitted session mode and opaque generation, independent of persistence."""

    enabled: bool
    generation: str


def transition_agent_session_policy(
    *,
    previous: AgentSessionPolicy | None,
    requested_enabled: bool | None,
    new_generation: str,
) -> AgentSessionPolicy:
    """Return the policy after an admitted save without obtaining external facts.

    Preconditions: modes are validated booleans; the caller supplies a fresh
    generation. ``previous=None`` means a new node; ``requested_enabled=None``
    means the save omitted the setting. Postconditions: omitted or unchanged
    settings preserve the previous generation, while a new node or actual mode
    change uses the supplied generation. Inputs remain unchanged; there is no I/O.
    """
    enabled = requested_enabled if requested_enabled is not None else previous.enabled if previous else True
    generation = previous.generation if previous is not None and enabled == previous.enabled else new_generation
    return AgentSessionPolicy(enabled=enabled, generation=generation)

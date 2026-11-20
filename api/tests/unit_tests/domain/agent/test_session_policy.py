"""Session policy transitions preserve continuity until an actual mode change."""

import pytest

from domain.agent.session_policy import AgentSessionPolicy, transition_agent_session_policy


@pytest.mark.parametrize("requested", [None, True])
def test_legacy_enabled_policy_keeps_its_generation_on_ordinary_saves(requested: bool | None) -> None:
    previous = AgentSessionPolicy(enabled=True, generation="")
    assert (
        transition_agent_session_policy(previous=previous, requested_enabled=requested, new_generation="fresh")
        == previous
    )


@pytest.mark.parametrize("enabled", [False, True])
def test_new_policy_uses_the_supplied_generation(enabled: bool) -> None:
    assert transition_agent_session_policy(
        previous=None, requested_enabled=enabled, new_generation="fresh"
    ) == AgentSessionPolicy(enabled=enabled, generation="fresh")


def test_disable_and_reenable_never_restore_the_original_generation() -> None:
    original = AgentSessionPolicy(enabled=True, generation="original")
    disabled = transition_agent_session_policy(previous=original, requested_enabled=False, new_generation="disabled")
    omitted = transition_agent_session_policy(previous=disabled, requested_enabled=None, new_generation="unused")
    enabled = transition_agent_session_policy(previous=omitted, requested_enabled=True, new_generation="enabled")
    assert disabled == AgentSessionPolicy(enabled=False, generation="disabled")
    assert omitted == disabled
    assert enabled == AgentSessionPolicy(enabled=True, generation="enabled")

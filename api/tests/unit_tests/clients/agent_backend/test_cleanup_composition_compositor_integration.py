"""Integration test for the cleanup request against the real agenton compositor.

The bug fixed by A+D was invisible to unit tests that use ``FakeAgentBackendRunClient``
because the fake client never runs agenton's ``_validate_session_snapshot``. This
test plugs a cleanup request through the real ``Compositor`` (with the same
providers the agent backend wires in production) so that the snapshot-vs-
composition name-order check would fail loudly if the cleanup builder ever
regressed back to the empty-composition shape.
"""

from __future__ import annotations

from typing import cast

import pytest
from agenton.compositor import Compositor, CompositorSessionSnapshot, LayerProvider
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID
from agenton_collections.layers.plain.basic import PromptLayer
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID, PydanticAIHistoryLayer

from clients.agent_backend import AgentBackendRunRequestBuilder, RuntimeLayerSpec


def test_cleanup_request_passes_agenton_snapshot_validation():
    """The cleanup request's composition layer names must match the (filtered)
    snapshot's layer names exactly — agenton's compositor enforces this and
    the agent backend rejects mismatches as ``run_failed`` asynchronously,
    which is the trap A/D fixed."""
    # Persisted (non-plugin) layer specs — these are what cleanup will replay.
    # We exclude the dify.execution_context layer from this integration check
    # because its real provider needs a plugin-daemon HTTP client; the cleanup
    # validation we are exercising is the snapshot-vs-composition name check,
    # which is purely structural and does not depend on which non-plugin layer
    # types appear.
    persisted_specs = [
        RuntimeLayerSpec(
            name="workflow_node_job_prompt",
            type=PLAIN_PROMPT_LAYER_TYPE_ID,
            config={"prefix": "Do the cleanup."},
        ),
        RuntimeLayerSpec(name="history", type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID),
    ]
    # Saved snapshot still carries the LLM layer entry — cleanup's
    # ``_filter_snapshot_to_specs`` must drop it so names match.
    full_snapshot = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="workflow_node_job_prompt",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
            LayerSessionSnapshot(
                name="history",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={"messages": []},
            ),
            LayerSessionSnapshot(
                name="llm",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
        ]
    )

    cleanup_request = AgentBackendRunRequestBuilder().build_cleanup_request(
        session_snapshot=full_snapshot,
        runtime_layer_specs=persisted_specs,
    )

    # Drive the real agenton compositor through ``from_config`` + ``_create_run``
    # the same way the agent backend's RunScheduler does. ``_create_run`` is the
    # private path that calls ``_validate_session_snapshot``; we use it directly
    # to keep the test synchronous (no async ``enter()`` lifecycle needed —
    # validation is the only thing under test).
    config = {
        "schema_version": 1,
        "layers": [
            {"name": layer.name, "type": layer.type, "deps": dict(layer.deps), "metadata": dict(layer.metadata)}
            for layer in cleanup_request.composition.layers
        ],
    }
    compositor = Compositor.from_config(
        config,
        providers=[
            LayerProvider.from_layer_type(PromptLayer),
            LayerProvider.from_layer_type(PydanticAIHistoryLayer),
        ],
    )

    layer_configs = {layer.name: layer.config for layer in cleanup_request.composition.layers}
    # This is the call that would raise ``ValueError`` if the cleanup snapshot
    # and composition disagreed on layer names — the exact failure mode the
    # original ``layers=[]`` cleanup hit.
    run = compositor._create_run(  # type: ignore[reportPrivateUsage]
        configs=cast(dict[str, object], layer_configs),
        session_snapshot=cleanup_request.session_snapshot,
    )
    assert list(run.slots.keys()) == ["workflow_node_job_prompt", "history"]


def test_cleanup_request_with_mismatched_specs_would_be_rejected_by_agenton():
    """Regression sentinel: if a future refactor stops filtering the snapshot,
    agenton would reject the request — and that rejection is what the runtime
    fix is preventing. We confirm the validator does fail when given the
    pre-fix shape so the previous test's success is not a coincidence."""
    snapshot_with_extra = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(
                name="history",
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
            LayerSessionSnapshot(
                name="llm",  # extra layer not in composition
                lifecycle_state=LifecycleState.SUSPENDED,
                runtime_state={},
            ),
        ]
    )
    compositor = Compositor.from_config(
        {
            "schema_version": 1,
            "layers": [{"name": "history", "type": PYDANTIC_AI_HISTORY_LAYER_TYPE_ID, "deps": {}, "metadata": {}}],
        },
        providers=[LayerProvider.from_layer_type(PydanticAIHistoryLayer)],
    )

    with pytest.raises(ValueError, match="layer names must match"):
        compositor._create_run(  # type: ignore[reportPrivateUsage]
            configs={},
            session_snapshot=snapshot_with_extra,
        )

from core.workflow.snippet_start import (
    LEGACY_START_NODE_ID,
    SNIPPET_VIRTUAL_START_NODE_ID,
    get_compatible_start_aliases,
)


def test_get_compatible_start_aliases_returns_legacy_start_for_snippet_virtual_start() -> None:
    aliases = get_compatible_start_aliases(
        workflow_kind="snippet",
        root_node_id=SNIPPET_VIRTUAL_START_NODE_ID,
    )

    assert aliases == (LEGACY_START_NODE_ID,)


def test_get_compatible_start_aliases_returns_empty_for_non_snippet_roots() -> None:
    aliases = get_compatible_start_aliases(
        workflow_kind="workflow",
        root_node_id=SNIPPET_VIRTUAL_START_NODE_ID,
    )

    assert aliases == ()

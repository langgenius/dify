from graphon.runtime import VariablePool

from core.workflow.variable_pool_initializer import add_node_inputs_to_pool


def test_add_node_inputs_to_pool_writes_primary_and_alias_selectors() -> None:
    variable_pool = VariablePool()

    add_node_inputs_to_pool(
        variable_pool,
        node_id="__snippet_virtual_start__",
        inputs={"query": "123"},
        aliases=("start",),
    )

    virtual_start_query = variable_pool.get(("__snippet_virtual_start__", "query"))
    legacy_start_query = variable_pool.get(("start", "query"))

    assert virtual_start_query is not None
    assert virtual_start_query.value == "123"
    assert legacy_start_query is not None
    assert legacy_start_query.value == "123"


def test_add_node_inputs_to_pool_deduplicates_aliases() -> None:
    variable_pool = VariablePool()

    add_node_inputs_to_pool(
        variable_pool,
        node_id="start",
        inputs={"query": "123"},
        aliases=("start",),
    )

    start_query = variable_pool.get(("start", "query"))

    assert start_query is not None
    assert start_query.value == "123"

import pytest

from core.variables.variables import StringVariable
from core.workflow.runtime import VariablePool
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, load_into_variable_pool


class StubVariableLoader:
    def __init__(self, variables_to_return: list[StringVariable]):
        self.variables_to_return = variables_to_return
        self.captured_selectors: list[list[str]] | None = None

    def load_variables(self, selectors: list[list[str]]):
        self.captured_selectors = selectors
        return self.variables_to_return


def test_dummy_variable_loader_returns_empty_list():
    assert DUMMY_VARIABLE_LOADER.load_variables([]) == []


def test_load_into_variable_pool_loads_only_missing_variables():
    pool = VariablePool()
    pool.add(
        ["node_1", "var_existing"],
        StringVariable(name="var_existing", value="exists", selector=["node_1", "var_existing"]),
    )

    variable_mapping = {
        "node_1.var_existing": ["node_1", "var_existing"],
        "node_1.var_input": ["node_1", "var_input"],
        "node_2.var_input": ["node_2", "var_input"],
        "node_3.var_load": ["node_3", "var_load"],
    }
    user_inputs = {
        "node_1.var_input": "from_key",
        "var_input": "from_node_variable_key",
    }

    loader = StubVariableLoader(
        [
            StringVariable(
                name="var_load",
                value="loaded",
                selector=["node_3", "var_load", "extra"],
            )
        ]
    )

    load_into_variable_pool(loader, pool, variable_mapping, user_inputs)

    assert loader.captured_selectors == [["node_3", "var_load"]]
    loaded_segment = pool.get(["node_3", "var_load"])
    assert loaded_segment is not None
    assert loaded_segment.value == "loaded"


def test_load_into_variable_pool_raises_on_invalid_key():
    pool = VariablePool()
    loader = StubVariableLoader([])

    with pytest.raises(ValueError, match="Invalid variable key"):
        load_into_variable_pool(loader, pool, {"invalid": ["node", "var"]}, {})


def test_load_into_variable_pool_rejects_invalid_variable_selector():
    pool = VariablePool()
    loader = StubVariableLoader(
        [
            StringVariable(
                name="bad",
                value="bad",
                selector=["node_only"],
            )
        ]
    )

    with pytest.raises(AssertionError, match="Invalid variable"):
        load_into_variable_pool(loader, pool, {"node.bad": ["node", "bad"]}, {})

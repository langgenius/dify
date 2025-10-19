import abc
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from core.variables import Variable
from core.variables.consts import SELECTORS_LENGTH
from core.workflow.runtime import VariablePool


class VariableLoader(Protocol):
    """Interface for loading variables based on selectors.

    A `VariableLoader` is responsible for retrieving additional variables required during the execution
    of a single node, which are not provided as user inputs.

    NOTE(QuantumGhost): Typically, all variables loaded by a `VariableLoader` should belong to the same
    application and share the same `app_id`. However, this interface does not enforce that constraint,
    and the `app_id` parameter is intentionally omitted from `load_variables` to achieve separation of
    concern and allow for flexible implementations.

    Implementations of `VariableLoader` should almost always have an `app_id` parameter in
    their constructor.

    TODO(QuantumGhost): this is a temporally workaround. If we can move the creation of node instance into
    `WorkflowService.single_step_run`, we may get rid of this interface.
    """

    @abc.abstractmethod
    def load_variables(self, selectors: list[list[str]]) -> list[Variable]:
        """Load variables based on the provided selectors. If the selectors are empty,
        this method should return an empty list.

        The order of the returned variables is not guaranteed. If the caller wants to ensure
        a specific order, they should sort the returned list themselves.

        :param: selectors: a list of string list, each inner list should have at least two elements:
            - the first element is the node ID,
            - the second element is the variable name.
        :return: a list of Variable objects that match the provided selectors.
        """
        pass


class _DummyVariableLoader(VariableLoader):
    """A dummy implementation of VariableLoader that does not load any variables.
    Serves as a placeholder when no variable loading is needed.
    """

    def load_variables(self, selectors: list[list[str]]) -> list[Variable]:
        return []


DUMMY_VARIABLE_LOADER = _DummyVariableLoader()


def load_into_variable_pool(
    variable_loader: VariableLoader,
    variable_pool: VariablePool,
    variable_mapping: Mapping[str, Sequence[str]],
    user_inputs: Mapping[str, Any],
):
    # Loading missing variable from draft var here, and set it into
    # variable_pool.
    variables_to_load: list[list[str]] = []
    for key, selector in variable_mapping.items():
        # NOTE(QuantumGhost): this logic needs to be in sync with
        # `WorkflowEntry.mapping_user_inputs_to_variable_pool`.
        node_variable_list = key.split(".")
        if len(node_variable_list) < 2:
            raise ValueError(f"Invalid variable key: {key}. It should have at least two elements.")
        if key in user_inputs:
            continue
        node_variable_key = ".".join(node_variable_list[1:])
        if node_variable_key in user_inputs:
            continue
        if variable_pool.get(selector) is None:
            variables_to_load.append(list(selector))
    loaded = variable_loader.load_variables(variables_to_load)
    for var in loaded:
        assert len(var.selector) >= SELECTORS_LENGTH, f"Invalid variable {var}"
        # Add variable directly to the pool
        # The variable pool expects 2-element selectors [node_id, variable_name]
        variable_pool.add([var.selector[0], var.selector[1]], var)

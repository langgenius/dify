import abc
from typing import Protocol

from core.variables import Variable


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

from abc import abstractmethod
from typing import Optional

from core.workflow.entities.node_entities import NodeType
from core.workflow.entities.variable_pool import VariablePool


class BaseNode:
    _node_type: NodeType

    def __int__(self, node_config: dict) -> None:
        self._node_config = node_config

    @abstractmethod
    def run(self, variable_pool: Optional[VariablePool] = None,
            run_args: Optional[dict] = None) -> dict:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        if variable_pool is None and run_args is None:
            raise ValueError("At least one of `variable_pool` or `run_args` must be provided.")

        return self._run(
            variable_pool=variable_pool,
            run_args=run_args
        )

    @abstractmethod
    def _run(self, variable_pool: Optional[VariablePool] = None,
             run_args: Optional[dict] = None) -> dict:
        """
        Run node
        :param variable_pool: variable pool
        :param run_args: run args
        :return:
        """
        raise NotImplementedError

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {}

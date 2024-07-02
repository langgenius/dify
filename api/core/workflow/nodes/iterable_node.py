from abc import ABC, abstractmethod
from typing import Any

from core.workflow.utils.condition.entities import Condition


class IterableNodeMixin(ABC):
    @classmethod
    @abstractmethod
    def get_conditions(cls, node_config: dict[str, Any]) -> list[Condition]:
        """
        Get conditions.
        """
        raise NotImplementedError

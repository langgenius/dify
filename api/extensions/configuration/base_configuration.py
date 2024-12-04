"""Abstract interface for configuration center implementations."""

from abc import ABC, abstractmethod
from typing import Any


class BaseConfiguration(ABC):
    """Interface for configuration center."""

    configuration_client: Any

    def __init__(self):  # noqa: B027
        pass

    # get configs from configuration center
    @abstractmethod
    def load_configs(self):
        raise NotImplementedError

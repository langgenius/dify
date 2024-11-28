"""Abstract interface for configuration center implementations."""

from abc import ABC, abstractmethod

from extensions.configuration.config_env import ConfigurationEnv


class BaseConfiguration(ABC):
    """Interface for configuration center."""

    def __init__(self):  # noqa: B027
        pass

    @abstractmethod
    def load_config_to_env_file(self, config_env: ConfigurationEnv):
        raise NotImplementedError

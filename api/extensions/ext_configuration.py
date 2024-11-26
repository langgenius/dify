import os

from extensions.configuration.base_configuration import BaseConfiguration
from extensions.configuration.configuration_type import ConfigurationType


class Configuration:
    def __init__(self):
        self.storage_runner = None

    def init_configuration(self):
        configuration_type = os.environ.get("CONFIGURATION_TYPE")
        if configuration_type:
            storage_factory = self.get_storage_factory(configuration_type)
            self.storage_runner = storage_factory()
            self.storage_runner.load_config_to_env_file()

    @staticmethod
    def get_storage_factory(storage_type: str) -> type[BaseConfiguration]:
        match storage_type:
            case ConfigurationType.APOLLO:
                from extensions.configuration.apollo_configuration import ApolloConfiguration

                return ApolloConfiguration

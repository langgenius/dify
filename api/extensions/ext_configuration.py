from extensions.configuration.base_configuration import BaseConfiguration
from extensions.configuration.config_env import ConfigurationEnv
from extensions.configuration.configuration_type import ConfigurationType


class Configuration:
    def __init__(self):
        self.storage_runner = None
        self.config_env = ConfigurationEnv()
        config_type = self.config_env.CONFIGURATION_TYPE
        if config_type:
            self.init_configuration(config_type)

    def init_configuration(self, config_type):
        storage_factory = self.get_storage_factory(config_type)
        self.storage_runner = storage_factory()
        self.storage_runner.load_config_to_env_file(self.config_env)

    @staticmethod
    def get_storage_factory(storage_type: str) -> type[BaseConfiguration]:
        match storage_type:
            case ConfigurationType.APOLLO:
                from extensions.configuration.apollo_configuration import ApolloConfiguration

                return ApolloConfiguration

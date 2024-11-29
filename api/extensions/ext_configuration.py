import logging

import configs
from extensions.configuration.base_configuration import BaseConfiguration
from extensions.configuration.configuration_type import ConfigurationType

log = logging.getLogger(__name__)


class ConfigurationCenter:
    def __init__(self):
        self.configuration_runner = None
        from configs import DifyConfig
        configuration_type = configs.dify_config.CONFIGURATION_TYPE
        if configuration_type:
            configuration_factory = self.get_configuration_factory(configuration_type)
            if not configuration_factory:
                log.warning(f"configuration center get failed, configuration type({configuration_type}) not exists")
                return

            self.configuration_runner = configuration_factory()
            self.configuration_runner.load_config_to_env_file()
            configs.dify_config = DifyConfig()

    @staticmethod
    def get_configuration_factory(configuration_type: str) -> type[BaseConfiguration]:
        match configuration_type:
            case ConfigurationType.APOLLO:
                from extensions.configuration.apollo_configuration import ApolloConfiguration

                return ApolloConfiguration

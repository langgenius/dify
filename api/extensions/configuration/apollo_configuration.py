from abc import ABC

from pydantic import parse_obj_as

import configs
from configs import DifyConfig, dify_config
from extensions.configuration.apollo.apollo_client import ApolloClient
from extensions.configuration.base_configuration import BaseConfiguration


class ApolloConfiguration(BaseConfiguration, ABC):
    """Implementation for Apollo Configuration."""

    def __init__(self):
        super().__init__()
        self.configuration_client = ApolloClient(app_id=dify_config.APOLLO_APP_ID, cluster=dify_config.APOLLO_CLUSTER,
                                                 config_url=dify_config.APOLLO_CONFIG_URL, start_hot_update=False,
                                                 _notification_map={dify_config.APOLLO_NAMESPACE: -1})

    def load_configs(self):
        # get all the config
        apollo_config_dicts = self.configuration_client.get_all_dicts(dify_config.APOLLO_NAMESPACE)
        configs.dify_config = parse_obj_as(DifyConfig, apollo_config_dicts)

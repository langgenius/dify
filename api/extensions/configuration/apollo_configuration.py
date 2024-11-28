import os

from extensions.configuration.apollo.apollo_client import ApolloClient
from extensions.configuration.base_configuration import BaseConfiguration


class ApolloConfiguration(BaseConfiguration):
    """Implementation for Apollo Configuration."""

    def load_config_to_env_file(self):
        client = ApolloClient(app_id=os.environ.get("APOLLO_APP_ID"), cluster=os.environ.get("APOLLO_CLUSTER"),
                              config_url=os.environ.get("APOLLO_CONFIG_URL"), start_hot_update=False,
                              _notification_map={os.environ.get("APOLLO_NAMESPACE"): -1})

        # Get the path to the .env file
        env_path = os.path.join(os.getcwd(), '.env')

        apollo_config_dicts = client.get_all_dicts(os.environ.get("APOLLO_NAMESPACE"))
        # Obtain the value of the configuration item from the Apollo configuration center
        # and write it to the .env file
        with open(env_path, 'w') as f:
            for key, value in apollo_config_dicts.items():
                f.write(f"{key}={value}\n")

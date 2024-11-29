import os

from configs import dify_config
from extensions.configuration.apollo.apollo_client import ApolloClient
from extensions.configuration.base_configuration import BaseConfiguration


class ApolloConfiguration(BaseConfiguration):
    """Implementation for Apollo Configuration."""

    def load_config_to_env_file(self):
        client = ApolloClient(app_id=dify_config.APOLLO_APP_ID, cluster=dify_config.APOLLO_CLUSTER,
                              config_url=dify_config.APOLLO_CONFIG_URL, start_hot_update=False,
                              _notification_map={dify_config.APOLLO_NAMESPACE: -1})

        # Get the path to the .env file
        env_path = os.path.join(os.getcwd(), '.env')

        apollo_config_dicts = client.get_all_dicts(dify_config.APOLLO_NAMESPACE)

        # Retrieve the existing environment variables from the .env file
        existing_vars = {}
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    key, value = line.strip().split('=', 1)
                    existing_vars[key.strip()] = value.strip()

        # Update the existing variables with the new Apollo configuration
        existing_vars.update(apollo_config_dicts)

        # Write the updated variables back to the .env file
        with open(env_path, 'w') as f:
            for key, value in existing_vars.items():
                f.write(f"{key}={value}\n")

class ModelProviderManager:
    """
    ModelProviderManager is a class that manages the model providers includes Hosting and Customize Model Providers.
    """

    def get_system_provider_configurations(self, tenant_id: str) -> list:
        """
        Get provider system configurations.

        :param tenant_id:
        :return:
        """
        pass

    def get_configurations(self, tenant_id: str) -> dict:
        """
        Get model provider configurations.

        :param tenant_id:
        :return:
        """
        # Get all provider records of the workspace

        # Get all provider model records of the workspace

        # decrypt all encrypted information of custom credentials

        # Get All preferred provider types of the workspace

        # Construct ProviderConfiguration objects for each provider
        # Including:
        # 1. Basic information of the provider
        # 2. Hosting configuration information, including:
        #   (1. Whether to enable (support) hosting type, if enabled, the following information exists
        #   (2. List of hosting type provider configurations
        #       (including quota type, quota limit, current remaining quota, etc.)
        #   (3. The current hosting type in use (whether there is a quota or not)
        #       paid quotas > provider free quotas > hosting trial quotas
        #   (4. Unified credentials for hosting providers
        # 3. Custom configuration information, including:
        #   (1. Whether to enable (support) custom type, if enabled, the following information exists
        #   (2. Custom provider configuration (including credentials)
        #   (3. List of custom provider model configurations (including credentials)
        # 4. Hosting/custom preferred provider type.
        # Provide methods:
        # - Get the current configuration (including credentials)
        # - Get the availability and status of the hosting configuration: active available,
        #   quota_exceeded insufficient quota, unsupported hosting
        # - Get the availability of custom configuration
        #   Custom provider available conditions:
        #   (1. provider credentials available
        #   (2. at least one model available
        # - Check the missing hosting provider records and fill them up
        # - Verify, update, and delete custom provider configuration
        # - Verify, update, and delete custom provider model configuration
        # - Get the list of available models (optional provider filtering, model type filtering)
        #   Append custom provider models to the list
        # - Get provider instance
        # - Switch selection priority

        # Return the encapsulated object
        pass

    def get_default_model_record(self, tenant_id: str, model_type: str):
        """
        Get default model record.

        :param tenant_id:
        :param model_type:
        :return:
        """
        # Get the corresponding TenantDefaultModel record

        # If it does not exist, get the first available provider model from get_configurations
        # and update the TenantDefaultModel record
        pass

    def update_default_model_record(self, tenant_id: str, model_type: str, model: str):
        """
        Update default model record.

        :param tenant_id:
        :param model_type:
        :param model:
        :return:
        """
        # Get the list of available models from get_configurations and check if it is LLM

        # create or update TenantDefaultModel record

        pass



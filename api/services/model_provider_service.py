import logging
import os
from typing import Optional

import requests

from models.provider import TenantDefaultModel


logger = logging.getLogger(__name__)


class ModelProviderService:
    """
    Model Provider Service
    """

    def get_provider_list(self, tenant_id: str, model_type: Optional[str] = None) -> list:
        """
        get provider list.

        :param tenant_id:
        :param model_type:
        :return:
        """
        # Get all providers from model runtime, only return pre-defined providers & models

        # Get the provider hosting configuration and get the quota information hosted by the team

        # Get Provider custom configuration status

        # Get preferred provider type

        return []

    def get_models_by_provider(self, tenant_id: str, provider: str) -> list:
        """
        get provider models.
        For the model provider page,
        only supports passing in a single provider to query the list of supported models.

        :param tenant_id:
        :param provider:
        :return:
        """
        # Get preferred provider type

        # If preferred provider type is `hosting`:
        #   Get the current **hosting mode** if provider supported,
        #   if all hosting modes are not available (no quota), it is considered to be the **custom credential mode**.
        #   If there is no model configured in custom mode, it is treated as no_configure.
        # hosting > custom > no_configure

        # If preferred provider type is `custom`:
        #   If custom credentials are configured, it is treated as custom mode.
        #   Otherwise, get the current **hosting mode** if supported,
        #   If all hosting modes are not available (no quota), it is treated as no_configure.
        # custom > hosting > no_configure

        # If real mode is `hosting`, use hosting credentials to get models,
        #   paid quotas > provider free quotas > hosting free quotas
        #   include pre-defined models (exclude GPT-4, status marked as `no_permission`), remote models.
        # If real mode is `custom`, use workspace custom credentials to get models,
        #   include pre-defined models, remote models and custom models(manual append).
        # If real mode is `no_configure`, only return pre-defined models from `model runtime`.
        #   (model status marked as `no_configure` if preferred provider type is `custom` otherwise `quota_exceeded`)
        # model status marked as `active` is available.

        # Construct list[ProviderConfig], pass in available providers and corresponding credentials

        return []

    def get_provider_credentials(self, tenant_id: str, provider: str) -> dict:
        """
        get provider credentials.

        :param tenant_id:
        :param provider:
        :return:
        """
        # Check if the provider's configure_method supports either `predefined-model` or `fetch-from-remote`.

        # Get provider custom credentials from workspace

        # Hide secret credential values to `***abc***` for security.
        # Fetch secret credential types from `provider_credential_schema` in the provider's schema.

        # return credentials

        return {}

    def provider_credentials_validate(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        validate provider credentials.

        :param tenant_id:
        :param provider:
        :param credentials:
        """
        # Check if the provider's configure_method supports either `predefined-model` or `fetch-from-remote`.

        # Get provider custom credentials from workspace

        # Fetch secret credential types from `provider_credential_schema` in the provider's schema.
        # Replace `[__HIDDEN__]` to real credential value.

        # Validate credentials

    def save_provider_credentials(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        save custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials
        :return:
        """
        # validate credentials
        self.provider_credentials_validate(tenant_id, provider, credentials)

        # save and encrypt provider credentials
        # Note: Do not switch the preferred provider, which allows users to use quotas first

    def remove_provider_credentials(self, tenant_id: str, provider: str) -> None:
        """
        remove custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :return:
        """
        # remove provider credentials

        # switch preferred provider if needed

    def get_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> dict:
        """
        get model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # Check if the provider's configure_method supports `customizable-model`.

        # Check model type is supported by provider.

        # Get model custom credentials from ProviderModel if exists

        # Hide secret credential values to `***abc***` for security.
        # Fetch secret credential types from `model_credential_schema` in the provider's schema.

        # return credentials

        return {}

    def model_credentials_validate(self, tenant_id: str, provider: str, model_type: str, model: str,
                                   credentials: dict) -> None:
        """
        validate model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Check if the provider's configure_method supports `customizable-model`.

        # Check model type is supported by provider.

        # Get model custom credentials from ProviderModel if exists

        # Fetch secret credential types from `model_credential_schema` in the provider's schema.
        # Replace `[__HIDDEN__]` to real credential value.

        # Validate credentials

    def save_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str,
                               credentials: dict) -> None:
        """
        save model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # validate credentials
        self.model_credentials_validate(tenant_id, provider, model_type, model, credentials)

        # save and encrypt model credentials
        # Note: Do not switch the preferred provider, which allows users to use quotas first

    def remove_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> None:
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # remove model credentials

        # switch preferred provider if all models credentials are removed

    def get_models_by_model_type(self, tenant_id: str, model_type: str) -> list:
        """
        get models by model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all available provider records for the current workspace

        # Get all preferred provider records for the current workspace

        # Group by provider, and get the real credentials used according to the preferred provider type
        # and hosting quota (if unavailable, there is no credentials)

        # If preferred provider type is `hosting`:
        #   Get the current **hosting mode** credentials if provider supported,
        #   if all hosting modes are not available (no quota),
        #   it is considered to be the **custom credential mode** and use provider custom credentials.
        #   If there is no model configured in custom mode, it is treated as no_configure and no credentials.
        # hosting > custom > no_configure

        # If preferred provider type is `custom`:
        #   If custom credentials are configured, it is treated as custom mode and use provider custom credentials.
        #   Otherwise, get the current **hosting mode** credentials if supported,
        #   If all hosting modes are not available (no quota), it is treated as no_configure and no credentials.
        # custom > hosting > no_configure

        # If real mode is `hosting`, use hosting credentials to get models,
        #   paid quotas > provider free quotas > hosting free quotas
        #   include pre-defined models (exclude GPT-4, status marked as `no_permission`), remote models.
        # If real mode is `custom`, use workspace custom credentials to get models,
        #   include pre-defined models, remote models and custom models(manual append).
        # If real mode is `no_configure`, only return pre-defined models from `model runtime`.
        #   (model status marked as `no_configure` if preferred provider type is `custom` otherwise `quota_exceeded`)
        # model status marked as `active` is available.

        # Construct list[ProviderConfig], pass in available providers and corresponding credentials

        # Get all available provider models and add them to the models list under providers
        # (if custom models are supported and provider real mode is `custom`)

        # (If the provider is in hosting mode and some models are not supported for calling in hosting mode,
        # set the model status to no_permission, otherwise it is active)

        # Set the provider status, active/no_configure

        return []

    def get_model_parameter_rules(self, tenant_id: str, provider: str, model: str) -> dict:
        """
        get model parameter rules.
        Only supports LLM.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :return:
        """
        # Get provider instance

        # Get model instance of LLM

        # Call get_parameter_rules method of model instance to get model parameter rules

        return {}

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> Optional[TenantDefaultModel]:
        """
        get default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # get default model of model type from TenantDefaultModel

        # if not found, get first available model of LLM (self.get_models_by_model_type)

        # return default model
        return None

    def update_default_model_of_model_type(self, tenant_id: str, model_type: str, provider: str, model: str) -> None:
        """
        update default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :param provider: provider name
        :param model: model name
        :return:
        """
        # Check model is available

        # fetch default model of model type from TenantDefaultModel

        # if not found, create new TenantDefaultModel

        # else update default model of model type

    def switch_preferred_provider(self, tenant_id: str, provider: str, preferred_provider_type: str) -> None:
        """
        switch preferred provider.

        :param tenant_id: workspace id
        :param provider: provider name
        :param preferred_provider_type: preferred provider type
        :return:
        """
        # Check if the provider's configure_method supports:
        # `customizable-model`: custom
        # `predefined-model` or `fetch-from-remote`: system

        # create or update TenantPreferredModelProvider

    def free_quota_submit(self, tenant_id: str, provider_name: str):
        api_key = os.environ.get("FREE_QUOTA_APPLY_API_KEY")
        api_base_url = os.environ.get("FREE_QUOTA_APPLY_BASE_URL")
        api_url = api_base_url + '/api/v1/providers/apply'

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {api_key}"
        }
        response = requests.post(api_url, headers=headers, json={'workspace_id': tenant_id, 'provider_name': provider_name})
        if not response.ok:
            logger.error(f"Request FREE QUOTA APPLY SERVER Error: {response.status_code} ")
            raise ValueError(f"Error: {response.status_code} ")

        if response.json()["code"] != 'success':
            raise ValueError(
                f"error: {response.json()['message']}"
            )

        rst = response.json()

        if rst['type'] == 'redirect':
            return {
                'type': rst['type'],
                'redirect_url': rst['redirect_url']
            }
        else:
            return {
                'type': rst['type'],
                'result': 'success'
            }

    def free_quota_qualification_verify(self, tenant_id: str, provider_name: str, token: Optional[str]):
        api_key = os.environ.get("FREE_QUOTA_APPLY_API_KEY")
        api_base_url = os.environ.get("FREE_QUOTA_APPLY_BASE_URL")
        api_url = api_base_url + '/api/v1/providers/qualification-verify'

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {api_key}"
        }
        json_data = {'workspace_id': tenant_id, 'provider_name': provider_name}
        if token:
            json_data['token'] = token
        response = requests.post(api_url, headers=headers,
                                 json=json_data)
        if not response.ok:
            logger.error(f"Request FREE QUOTA APPLY SERVER Error: {response.status_code} ")
            raise ValueError(f"Error: {response.status_code} ")

        rst = response.json()
        if rst["code"] != 'success':
            raise ValueError(
                f"error: {rst['message']}"
            )

        data = rst['data']
        if data['qualified'] is True:
            return {
                'result': 'success',
                'provider_name': provider_name,
                'flag': True
            }
        else:
            return {
                'result': 'success',
                'provider_name': provider_name,
                'flag': False,
                'reason': data['reason']
            }

from copy import deepcopy
from typing import Any

from pydantic import BaseModel

from core.helper import encrypter
from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCacheType
from core.helper.tool_provider_cache import ToolProviderCredentialsCache, ToolProviderCredentialsCacheType
from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolProviderCredentials,
)
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.tool import Tool


class ToolConfigurationManager(BaseModel):
    tenant_id: str
    provider_controller: ToolProviderController

    def _deep_copy(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        deep copy credentials
        """
        return deepcopy(credentials)

    def encrypt_tool_credentials(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        encrypt tool credentials with tenant id

        return a deep copy of credentials with encrypted values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    encrypted = encrypter.encrypt_token(self.tenant_id, credentials[field_name])
                    credentials[field_name] = encrypted

        return credentials

    def mask_tool_credentials(self, credentials: dict[str, Any]) -> dict[str, Any]:
        """
        mask tool credentials

        return a deep copy of credentials with masked values
        """
        credentials = self._deep_copy(credentials)

        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    if len(credentials[field_name]) > 6:
                        credentials[field_name] = (
                            credentials[field_name][:2]
                            + "*" * (len(credentials[field_name]) - 4)
                            + credentials[field_name][-2:]
                        )
                    else:
                        credentials[field_name] = "*" * len(credentials[field_name])

        return credentials

    def decrypt_tool_credentials(self, credentials: dict[str, str]) -> dict[str, str]:
        """
        decrypt tool credentials with tenant id

        return a deep copy of credentials with decrypted values
        """
        cache = ToolProviderCredentialsCache(
            tenant_id=self.tenant_id,
            identity_id=f"{self.provider_controller.provider_type.value}.{self.provider_controller.identity.name}",
            cache_type=ToolProviderCredentialsCacheType.PROVIDER,
        )
        cached_credentials = cache.get()
        if cached_credentials:
            return cached_credentials
        credentials = self._deep_copy(credentials)
        # get fields need to be decrypted
        fields = self.provider_controller.get_credentials_schema()
        for field_name, field in fields.items():
            if field.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT:
                if field_name in credentials:
                    try:
                        credentials[field_name] = encrypter.decrypt_token(self.tenant_id, credentials[field_name])
                    except:
                        pass

        cache.set(credentials)
        return credentials

    def delete_tool_credentials_cache(self):
        cache = ToolProviderCredentialsCache(
            tenant_id=self.tenant_id,
            identity_id=f"{self.provider_controller.provider_type.value}.{self.provider_controller.identity.name}",
            cache_type=ToolProviderCredentialsCacheType.PROVIDER,
        )
        cache.delete()


class ToolParameterConfigurationManager(BaseModel):
    """
    Tool parameter configuration manager
    """

    tenant_id: str
    tool_runtime: Tool
    provider_name: str
    provider_type: str
    identity_id: str

    def _deep_copy(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        deep copy parameters
        """
        return deepcopy(parameters)

    def _merge_parameters(self) -> list[ToolParameter]:
        """
        merge parameters
        """
        # get tool parameters
        tool_parameters = self.tool_runtime.parameters or []
        # get tool runtime parameters
        runtime_parameters = self.tool_runtime.get_runtime_parameters() or []
        # override parameters
        current_parameters = tool_parameters.copy()
        for runtime_parameter in runtime_parameters:
            found = False
            for index, parameter in enumerate(current_parameters):
                if parameter.name == runtime_parameter.name and parameter.form == runtime_parameter.form:
                    current_parameters[index] = runtime_parameter
                    found = True
                    break

            if not found and runtime_parameter.form == ToolParameter.ToolParameterForm.FORM:
                current_parameters.append(runtime_parameter)

        return current_parameters

    def mask_tool_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        mask tool parameters

        return a deep copy of parameters with masked values
        """
        parameters = self._deep_copy(parameters)

        # override parameters
        current_parameters = self._merge_parameters()

        for parameter in current_parameters:
            if (
                parameter.form == ToolParameter.ToolParameterForm.FORM
                and parameter.type == ToolParameter.ToolParameterType.SECRET_INPUT
            ):
                if parameter.name in parameters:
                    if len(parameters[parameter.name]) > 6:
                        parameters[parameter.name] = (
                            parameters[parameter.name][:2]
                            + "*" * (len(parameters[parameter.name]) - 4)
                            + parameters[parameter.name][-2:]
                        )
                    else:
                        parameters[parameter.name] = "*" * len(parameters[parameter.name])

        return parameters

    def encrypt_tool_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        encrypt tool parameters with tenant id

        return a deep copy of parameters with encrypted values
        """
        # override parameters
        current_parameters = self._merge_parameters()

        parameters = self._deep_copy(parameters)

        for parameter in current_parameters:
            if (
                parameter.form == ToolParameter.ToolParameterForm.FORM
                and parameter.type == ToolParameter.ToolParameterType.SECRET_INPUT
            ):
                if parameter.name in parameters:
                    encrypted = encrypter.encrypt_token(self.tenant_id, parameters[parameter.name])
                    parameters[parameter.name] = encrypted

        return parameters

    def decrypt_tool_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        decrypt tool parameters with tenant id

        return a deep copy of parameters with decrypted values
        """
        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type}.{self.provider_name}",
            tool_name=self.tool_runtime.identity.name,
            cache_type=ToolParameterCacheType.PARAMETER,
            identity_id=self.identity_id,
        )
        cached_parameters = cache.get()
        if cached_parameters:
            return cached_parameters

        # override parameters
        current_parameters = self._merge_parameters()
        has_secret_input = False

        for parameter in current_parameters:
            if (
                parameter.form == ToolParameter.ToolParameterForm.FORM
                and parameter.type == ToolParameter.ToolParameterType.SECRET_INPUT
            ):
                if parameter.name in parameters:
                    try:
                        has_secret_input = True
                        parameters[parameter.name] = encrypter.decrypt_token(self.tenant_id, parameters[parameter.name])
                    except:
                        pass

        if has_secret_input:
            cache.set(parameters)

        return parameters

    def delete_tool_parameters_cache(self):
        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type}.{self.provider_name}",
            tool_name=self.tool_runtime.identity.name,
            cache_type=ToolParameterCacheType.PARAMETER,
            identity_id=self.identity_id,
        )
        cache.delete()

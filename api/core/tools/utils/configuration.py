import contextlib
from collections.abc import Mapping
from copy import deepcopy

from core.helper import encrypter
from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCachePayload, ToolParameterCacheType
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolProviderType,
)


class ToolParameterConfigurationManager:
    """
    Tool parameter configuration manager
    """

    tenant_id: str
    tool_runtime: Tool
    provider_name: str
    provider_type: ToolProviderType
    identity_id: str

    def __init__(
        self, tenant_id: str, tool_runtime: Tool, provider_name: str, provider_type: ToolProviderType, identity_id: str
    ):
        self.tenant_id = tenant_id
        self.tool_runtime = tool_runtime
        self.provider_name = provider_name
        self.provider_type = provider_type
        self.identity_id = identity_id

    def _deep_copy(self, parameters: ToolParameterCachePayload) -> ToolParameterCachePayload:
        """
        deep copy parameters
        """
        return deepcopy(parameters)

    @staticmethod
    def _get_secret_parameter_value(parameters: Mapping[str, object], parameter_name: str) -> str | None:
        raw_value = parameters.get(parameter_name)
        return raw_value if isinstance(raw_value, str) else None

    def _merge_parameters(self) -> list[ToolParameter]:
        """
        merge parameters
        """
        # get tool parameters
        tool_parameters = self.tool_runtime.entity.parameters or []
        # get tool runtime parameters
        runtime_parameters = self.tool_runtime.get_runtime_parameters()
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

    def mask_tool_parameters(self, parameters: ToolParameterCachePayload) -> ToolParameterCachePayload:
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
                secret_value = self._get_secret_parameter_value(parameters, parameter.name)
                if secret_value is None:
                    continue

                if len(secret_value) > 6:
                    parameters[parameter.name] = secret_value[:2] + "*" * (len(secret_value) - 4) + secret_value[-2:]
                else:
                    parameters[parameter.name] = "*" * len(secret_value)

        return parameters

    def encrypt_tool_parameters(self, parameters: ToolParameterCachePayload) -> ToolParameterCachePayload:
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
                secret_value = self._get_secret_parameter_value(parameters, parameter.name)
                if secret_value is not None:
                    parameters[parameter.name] = encrypter.encrypt_token(self.tenant_id, secret_value)

        return parameters

    def decrypt_tool_parameters(self, parameters: ToolParameterCachePayload) -> ToolParameterCachePayload:
        """
        decrypt tool parameters with tenant id

        return a deep copy of parameters with decrypted values
        """
        parameters = self._deep_copy(parameters)

        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type.value}.{self.provider_name}",
            tool_name=self.tool_runtime.entity.identity.name,
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
                secret_value = self._get_secret_parameter_value(parameters, parameter.name)
                if secret_value is None:
                    continue

                has_secret_input = True
                with contextlib.suppress(Exception):
                    parameters[parameter.name] = encrypter.decrypt_token(self.tenant_id, secret_value)

        if has_secret_input:
            cache.set(parameters)

        return parameters

    def delete_tool_parameters_cache(self) -> None:
        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type.value}.{self.provider_name}",
            tool_name=self.tool_runtime.entity.identity.name,
            cache_type=ToolParameterCacheType.PARAMETER,
            identity_id=self.identity_id,
        )
        cache.delete()

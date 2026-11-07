import contextlib
import hashlib
import json
from copy import deepcopy
from typing import Any

from core.helper import encrypter
from core.helper.tool_parameter_cache import ToolParameterCache, ToolParameterCacheType
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolProviderType,
)

_CACHE_FINGERPRINT_KEY = "__cache_fingerprint"


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

    def _secret_input_fingerprint(self, parameters: dict[str, Any], current_parameters: list[ToolParameter]) -> str:
        """
        fingerprint the secret-form input values so a cache entry is only reused when it was
        built from the same secret inputs. Without this, a dynamically bound secret-input
        parameter (e.g. inside a loop/iteration node) would keep the first call's decrypted
        value cached and silently reuse it for every later call with a different value.
        """
        material = {
            parameter.name: parameters.get(parameter.name)
            for parameter in current_parameters
            if parameter.form == ToolParameter.ToolParameterForm.FORM
            and parameter.type == ToolParameter.ToolParameterType.SECRET_INPUT
        }
        canonical = json.dumps(material, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def decrypt_tool_parameters(self, parameters: dict[str, Any]) -> dict[str, Any]:
        """
        decrypt tool parameters with tenant id

        return a deep copy of parameters with decrypted values

        Only the decrypted secret-input fields are ever served from cache, merged onto the
        current call's own (freshly resolved) non-secret values. The cache never supplies a
        wholesale historical parameter dict, so a non-secret FORM parameter that varies
        per-call (e.g. a loop-bound recipient) can never be served stale alongside a secret
        that happens to stay constant.
        """
        parameters = self._deep_copy(parameters)

        # override parameters
        current_parameters = self._merge_parameters()
        fingerprint = self._secret_input_fingerprint(parameters, current_parameters)
        secret_parameters = [
            parameter
            for parameter in current_parameters
            if parameter.form == ToolParameter.ToolParameterForm.FORM
            and parameter.type == ToolParameter.ToolParameterType.SECRET_INPUT
        ]

        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type.value}.{self.provider_name}",
            tool_name=self.tool_runtime.entity.identity.name,
            cache_type=ToolParameterCacheType.PARAMETER,
            identity_id=self.identity_id,
        )
        cached_secrets = cache.get()
        if cached_secrets and cached_secrets.get(_CACHE_FINGERPRINT_KEY) == fingerprint:
            for parameter in secret_parameters:
                if parameter.name in cached_secrets:
                    parameters[parameter.name] = cached_secrets[parameter.name]
            return parameters

        has_secret_input = False
        decrypted_secrets: dict[str, Any] = {}

        for parameter in secret_parameters:
            if parameter.name in parameters:
                has_secret_input = True
                with contextlib.suppress(Exception):
                    parameters[parameter.name] = encrypter.decrypt_token(self.tenant_id, parameters[parameter.name])
                decrypted_secrets[parameter.name] = parameters[parameter.name]

        if has_secret_input:
            cache.set({**decrypted_secrets, _CACHE_FINGERPRINT_KEY: fingerprint})

        return parameters

    def delete_tool_parameters_cache(self):
        cache = ToolParameterCache(
            tenant_id=self.tenant_id,
            provider=f"{self.provider_type.value}.{self.provider_name}",
            tool_name=self.tool_runtime.entity.identity.name,
            cache_type=ToolParameterCacheType.PARAMETER,
            identity_id=self.identity_id,
        )
        cache.delete()

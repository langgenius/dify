from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig
from core.tools.entities.tool_entities import (
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.tool import Tool


class ToolProviderController(BaseModel, ABC):
    identity: ToolProviderIdentity
    tools: list[Tool] = Field(default_factory=list)
    credentials_schema: dict[str, ProviderConfig] = Field(default_factory=dict)

    def get_credentials_schema(self) -> dict[str, ProviderConfig]:
        """
            returns the credentials schema of the provider

            :return: the credentials schema
        """
        return self.credentials_schema.copy()
    
    @abstractmethod
    def get_tool(self, tool_name: str) -> Tool:
        """
            returns a tool that the provider can provide

            :return: tool
        """
        pass

    @property
    def provider_type(self) -> ToolProviderType:
        """
            returns the type of the provider

            :return: type of the provider
        """
        return ToolProviderType.BUILT_IN

    def validate_credentials_format(self, credentials: dict[str, Any]) -> None:
        """
            validate the format of the credentials of the provider and set the default value if needed

            :param credentials: the credentials of the tool
        """
        credentials_schema = self.credentials_schema
        if credentials_schema is None:
            return
        
        credentials_need_to_validate: dict[str, ProviderConfig] = {}
        for credential_name in credentials_schema:
            credentials_need_to_validate[credential_name] = credentials_schema[credential_name]

        for credential_name in credentials:
            if credential_name not in credentials_need_to_validate:
                raise ToolProviderCredentialValidationError(f'credential {credential_name} not found in provider {self.identity.name}')
            
            # check type
            credential_schema = credentials_need_to_validate[credential_name]
            if credential_schema == ProviderConfig.Type.SECRET_INPUT or \
                credential_schema == ProviderConfig.Type.TEXT_INPUT:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f'credential {credential_name} should be string')
            
            elif credential_schema.type == ProviderConfig.Type.SELECT:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f'credential {credential_name} should be string')
                
                options = credential_schema.options
                if not isinstance(options, list):
                    raise ToolProviderCredentialValidationError(f'credential {credential_name} options should be list')
                
                if credentials[credential_name] not in [x.value for x in options]:
                    raise ToolProviderCredentialValidationError(f'credential {credential_name} should be one of {options}')
                
            credentials_need_to_validate.pop(credential_name)

        for credential_name in credentials_need_to_validate:
            credential_schema = credentials_need_to_validate[credential_name]
            if credential_schema.required:
                raise ToolProviderCredentialValidationError(f'credential {credential_name} is required')
            
            # the credential is not set currently, set the default value if needed
            if credential_schema.default is not None:
                default_value = credential_schema.default
                # parse default value into the correct type
                if credential_schema.type == ProviderConfig.Type.SECRET_INPUT or \
                    credential_schema.type == ProviderConfig.Type.TEXT_INPUT or \
                    credential_schema.type == ProviderConfig.Type.SELECT:
                    default_value = str(default_value)

                credentials[credential_name] = default_value
    
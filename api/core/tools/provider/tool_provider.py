from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel

from core.tools.entities.tool_entities import (
    ToolParameter,
    ToolProviderCredentials,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.errors import ToolNotFoundError, ToolParameterValidationError, ToolProviderCredentialValidationError
from core.tools.tool.tool import Tool


class ToolProviderController(BaseModel, ABC):
    identity: Optional[ToolProviderIdentity] = None
    tools: Optional[list[Tool]] = None
    credentials_schema: Optional[dict[str, ToolProviderCredentials]] = None

    def get_credentials_schema(self) -> dict[str, ToolProviderCredentials]:
        """
        returns the credentials schema of the provider

        :return: the credentials schema
        """
        if self.credentials_schema is None:
            return {}
        return self.credentials_schema.copy()

    @abstractmethod
    def get_tools(self, user_id: str = "", tenant_id: str = "") -> Optional[list[Tool]]:
        """
        returns a list of tools that the provider can provide

        :return: list of tools
        """
        pass

    @abstractmethod
    def get_tool(self, tool_name: str) -> Optional[Tool]:
        """
        returns a tool that the provider can provide

        :return: tool
        """
        pass

    def get_parameters(self, tool_name: str) -> list[ToolParameter]:
        """
        returns the parameters of the tool

        :param tool_name: the name of the tool, defined in `get_tools`
        :return: list of parameters
        """
        tools = self.get_tools()
        if tools is None:
            raise ToolNotFoundError(f"tool {tool_name} not found")
        tool = next((t for t in tools if t.identity and t.identity.name == tool_name), None)
        if tool is None:
            raise ToolNotFoundError(f"tool {tool_name} not found")
        return tool.parameters or []

    @property
    def provider_type(self) -> ToolProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return ToolProviderType.BUILT_IN

    def validate_parameters(self, tool_id: int, tool_name: str, tool_parameters: dict[str, Any]) -> None:
        """
        validate the parameters of the tool and set the default value if needed

        :param tool_name: the name of the tool, defined in `get_tools`
        :param tool_parameters: the parameters of the tool
        """
        tool_parameters_schema = self.get_parameters(tool_name)

        tool_parameters_need_to_validate: dict[str, ToolParameter] = {}
        for parameter in tool_parameters_schema:
            tool_parameters_need_to_validate[parameter.name] = parameter

        for tool_parameter in tool_parameters:
            if tool_parameter not in tool_parameters_need_to_validate:
                raise ToolParameterValidationError(f"parameter {tool_parameter} not found in tool {tool_name}")

            # check type
            parameter_schema = tool_parameters_need_to_validate[tool_parameter]
            if parameter_schema.type == ToolParameter.ToolParameterType.STRING:
                if not isinstance(tool_parameters[tool_parameter], str):
                    raise ToolParameterValidationError(f"parameter {tool_parameter} should be string")

            elif parameter_schema.type == ToolParameter.ToolParameterType.NUMBER:
                if not isinstance(tool_parameters[tool_parameter], int | float):
                    raise ToolParameterValidationError(f"parameter {tool_parameter} should be number")

                if parameter_schema.min is not None and tool_parameters[tool_parameter] < parameter_schema.min:
                    raise ToolParameterValidationError(
                        f"parameter {tool_parameter} should be greater than {parameter_schema.min}"
                    )

                if parameter_schema.max is not None and tool_parameters[tool_parameter] > parameter_schema.max:
                    raise ToolParameterValidationError(
                        f"parameter {tool_parameter} should be less than {parameter_schema.max}"
                    )

            elif parameter_schema.type == ToolParameter.ToolParameterType.BOOLEAN:
                if not isinstance(tool_parameters[tool_parameter], bool):
                    raise ToolParameterValidationError(f"parameter {tool_parameter} should be boolean")

            elif parameter_schema.type == ToolParameter.ToolParameterType.SELECT:
                if not isinstance(tool_parameters[tool_parameter], str):
                    raise ToolParameterValidationError(f"parameter {tool_parameter} should be string")

                options = parameter_schema.options
                if not isinstance(options, list):
                    raise ToolParameterValidationError(f"parameter {tool_parameter} options should be list")

                if tool_parameters[tool_parameter] not in [x.value for x in options]:
                    raise ToolParameterValidationError(f"parameter {tool_parameter} should be one of {options}")

            tool_parameters_need_to_validate.pop(tool_parameter)

        for tool_parameter_validate in tool_parameters_need_to_validate:
            parameter_schema = tool_parameters_need_to_validate[tool_parameter_validate]
            if parameter_schema.required:
                raise ToolParameterValidationError(f"parameter {tool_parameter_validate} is required")

            # the parameter is not set currently, set the default value if needed
            if parameter_schema.default is not None:
                tool_parameters[tool_parameter_validate] = parameter_schema.type.cast_value(parameter_schema.default)

    def validate_credentials_format(self, credentials: dict[str, Any]) -> None:
        """
        validate the format of the credentials of the provider and set the default value if needed

        :param credentials: the credentials of the tool
        """
        credentials_schema = self.credentials_schema
        if credentials_schema is None:
            return

        credentials_need_to_validate: dict[str, ToolProviderCredentials] = {}
        for credential_name in credentials_schema:
            credentials_need_to_validate[credential_name] = credentials_schema[credential_name]

        for credential_name in credentials:
            if credential_name not in credentials_need_to_validate:
                if self.identity is None:
                    raise ValueError("identity is not set")
                raise ToolProviderCredentialValidationError(
                    f"credential {credential_name} not found in provider {self.identity.name}"
                )

            # check type
            credential_schema = credentials_need_to_validate[credential_name]
            if not credential_schema.required and credentials[credential_name] is None:
                continue

            if credential_schema.type in {
                ToolProviderCredentials.CredentialsType.SECRET_INPUT,
                ToolProviderCredentials.CredentialsType.TEXT_INPUT,
            }:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} should be string")

            elif credential_schema.type == ToolProviderCredentials.CredentialsType.SELECT:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} should be string")

                options = credential_schema.options
                if not isinstance(options, list):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} options should be list")

                if credentials[credential_name] not in [x.value for x in options]:
                    raise ToolProviderCredentialValidationError(
                        f"credential {credential_name} should be one of {options}"
                    )

            credentials_need_to_validate.pop(credential_name)

        for credential_name in credentials_need_to_validate:
            credential_schema = credentials_need_to_validate[credential_name]
            if credential_schema.required:
                raise ToolProviderCredentialValidationError(f"credential {credential_name} is required")

            # the credential is not set currently, set the default value if needed
            if credential_schema.default is not None:
                default_value = credential_schema.default
                # parse default value into the correct type
                if credential_schema.type in {
                    ToolProviderCredentials.CredentialsType.SECRET_INPUT,
                    ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    ToolProviderCredentials.CredentialsType.SELECT,
                }:
                    default_value = str(default_value)

                credentials[credential_name] = default_value

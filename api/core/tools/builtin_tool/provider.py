from abc import abstractmethod
from os import listdir, path
from typing import Any

from core.entities.provider_entities import ProviderConfig
from core.helper.module_import_helper import load_single_subclass_from_source
from core.tools.__base.tool_provider import ToolProviderController
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolEntity, ToolProviderEntity, ToolProviderType
from core.tools.entities.values import ToolLabelEnum, default_tool_label_dict
from core.tools.errors import (
    ToolProviderNotFoundError,
)
from core.tools.utils.yaml_utils import load_yaml_file


class BuiltinToolProviderController(ToolProviderController):
    tools: list[BuiltinTool]

    def __init__(self, **data: Any) -> None:
        self.tools = []

        # load provider yaml
        provider = self.__class__.__module__.split(".")[-1]
        yaml_path = path.join(path.dirname(path.realpath(__file__)), "providers", provider, f"{provider}.yaml")
        try:
            provider_yaml = load_yaml_file(yaml_path, ignore_error=False)
        except Exception as e:
            raise ToolProviderNotFoundError(f"can not load provider yaml for {provider}: {e}")

        if "credentials_for_provider" in provider_yaml and provider_yaml["credentials_for_provider"] is not None:
            # set credentials name
            for credential_name in provider_yaml["credentials_for_provider"]:
                provider_yaml["credentials_for_provider"][credential_name]["name"] = credential_name

        credentials_schema = []
        for credential in provider_yaml.get("credentials_for_provider", {}):
            credential_dict = provider_yaml.get("credentials_for_provider", {}).get(credential, {})
            credentials_schema.append(credential_dict)

        super().__init__(
            entity=ToolProviderEntity(
                identity=provider_yaml["identity"],
                credentials_schema=credentials_schema,
            ),
        )

        self._load_tools()

    def _load_tools(self):
        provider = self.entity.identity.name
        tool_path = path.join(path.dirname(path.realpath(__file__)), "providers", provider, "tools")
        # get all the yaml files in the tool path
        tool_files = list(filter(lambda x: x.endswith(".yaml") and not x.startswith("__"), listdir(tool_path)))
        tools = []
        for tool_file in tool_files:
            # get tool name
            tool_name = tool_file.split(".")[0]
            tool = load_yaml_file(path.join(tool_path, tool_file), ignore_error=False)

            # get tool class, import the module
            assistant_tool_class: type[BuiltinTool] = load_single_subclass_from_source(
                module_name=f"core.tools.builtin_tool.providers.{provider}.tools.{tool_name}",
                script_path=path.join(
                    path.dirname(path.realpath(__file__)),
                    "builtin_tool",
                    "providers",
                    provider,
                    "tools",
                    f"{tool_name}.py",
                ),
                parent_type=BuiltinTool,
            )
            tool["identity"]["provider"] = provider
            tools.append(
                assistant_tool_class(
                    provider=provider,
                    entity=ToolEntity(**tool),
                    runtime=ToolRuntime(tenant_id=""),
                )
            )

        self.tools = tools

    def _get_builtin_tools(self) -> list[BuiltinTool]:
        """
        returns a list of tools that the provider can provide

        :return: list of tools
        """
        return self.tools

    def get_credentials_schema(self) -> list[ProviderConfig]:
        """
        returns the credentials schema of the provider

        :return: the credentials schema
        """
        if not self.entity.credentials_schema:
            return []

        return self.entity.credentials_schema.copy()

    def get_tools(self) -> list[BuiltinTool]:
        """
        returns a list of tools that the provider can provide

        :return: list of tools
        """
        return self._get_builtin_tools()

    def get_tool(self, tool_name: str) -> BuiltinTool | None:  # type: ignore
        """
        returns the tool that the provider can provide
        """
        return next(filter(lambda x: x.entity.identity.name == tool_name, self.get_tools()), None)  # type: ignore

    @property
    def need_credentials(self) -> bool:
        """
        returns whether the provider needs credentials

        :return: whether the provider needs credentials
        """
        return self.entity.credentials_schema is not None and len(self.entity.credentials_schema) != 0

    @property
    def provider_type(self) -> ToolProviderType:
        """
        returns the type of the provider

        :return: type of the provider
        """
        return ToolProviderType.BUILT_IN

    @property
    def tool_labels(self) -> list[str]:
        """
        returns the labels of the provider

        :return: labels of the provider
        """
        label_enums = self._get_tool_labels()
        return [default_tool_label_dict[label].name for label in label_enums]

    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        """
        returns the labels of the provider
        """
        return self.entity.identity.tags or []

    def validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider

        :param user_id: use id
        :param credentials: the credentials of the tool
        """
        # validate credentials format
        self.validate_credentials_format(credentials)

        # validate credentials
        self._validate_credentials(user_id, credentials)

    @abstractmethod
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider

        :param user_id: use id
        :param credentials: the credentials of the tool
        """
        pass

from collections.abc import Mapping
from typing import Any, cast

from core.extension.extensible import ExtensionModule
from extensions.ext_code_based_extension import code_based_extension


class ExternalDataToolFactory:
    def __init__(self, name: str, tenant_id: str, app_id: str, variable: str, config: dict):
        extension_class = code_based_extension.extension_class(ExtensionModule.EXTERNAL_DATA_TOOL, name)
        self.__extension_instance = extension_class(
            tenant_id=tenant_id, app_id=app_id, variable=variable, config=config
        )

    @classmethod
    def validate_config(cls, name: str, tenant_id: str, config: dict):
        """
        Validate the incoming form config data.

        :param name: the name of external data tool
        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        extension_class = code_based_extension.extension_class(ExtensionModule.EXTERNAL_DATA_TOOL, name)
        # FIXME mypy issue here, figure out how to fix it
        extension_class.validate_config(tenant_id, config)  # type: ignore

    def query(self, inputs: Mapping[str, Any], query: str | None = None) -> str:
        """
        Query the external data tool.

        :param inputs: user inputs
        :param query: the query of chat app
        :return: the tool query result
        """
        return cast(str, self.__extension_instance.query(inputs, query))

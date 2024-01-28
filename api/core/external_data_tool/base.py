from abc import ABC, abstractmethod
from typing import Optional

from core.extension.extensible import Extensible, ExtensionModule


class ExternalDataTool(Extensible, ABC):
    """
    The base class of external data tool.
    """

    module: ExtensionModule = ExtensionModule.EXTERNAL_DATA_TOOL

    app_id: str
    """the id of app"""
    variable: str
    """the tool variable name of app tool"""

    def __init__(self, tenant_id: str, app_id: str, variable: str, config: Optional[dict] = None) -> None:
        super().__init__(tenant_id, config)
        self.app_id = app_id
        self.variable = variable

    @classmethod
    @abstractmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        raise NotImplementedError

    @abstractmethod
    def query(self, inputs: dict, query: Optional[str] = None) -> str:
        """
        Query the external data tool.

        :param inputs: user inputs
        :param query: the query of chat app
        :return: the tool query result
        """
        raise NotImplementedError

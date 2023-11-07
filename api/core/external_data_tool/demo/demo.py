from typing import Optional

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.external_data_tool.base import ExternalDataTool
from core.helper import encrypter
from extensions.ext_database import db
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint


class DemoExternalDataTool(ExternalDataTool):
    """
    The api external data tool.
    """

    name: str = "demo"
    """the unique name of external data tool"""

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        pass

    def query(self, inputs: dict, query: Optional[str] = None) -> str:
        """
        Query the external data tool.

        :param inputs: user inputs
        :param query: the query of chat app
        :return: the tool query result
        """
        pass

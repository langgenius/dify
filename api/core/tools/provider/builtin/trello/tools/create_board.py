from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CreateBoardTool(BuiltinTool):
    """
    Tool for creating a new Trello board.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]) -> ToolInvokeMessage:
        """
        Invoke the tool to create a new Trello board.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool]]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")
        board_name = tool_parameters.get("name")

        if not (api_key and token and board_name):
            return self.create_text_message("Missing required parameters: API key, token, or board name.")

        url = "https://api.trello.com/1/boards/"
        query_params = {"name": board_name, "key": api_key, "token": token}

        try:
            response = requests.post(url, params=query_params)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to create board")

        board = response.json()
        return self.create_text_message(
            text=f"Board created successfully! Board name: {board['name']}, ID: {board['id']}"
        )

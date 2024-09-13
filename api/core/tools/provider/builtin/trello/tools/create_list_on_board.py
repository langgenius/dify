from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CreateListOnBoardTool(BuiltinTool):
    """
    Tool for creating a list on a Trello board by its ID.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]) -> ToolInvokeMessage:
        """
        Invoke the tool to create a list on a Trello board by its ID.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool]]): The parameters for the tool invocation,
             including the board ID and list name.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")
        board_id = tool_parameters.get("id")
        list_name = tool_parameters.get("name")

        if not (api_key and token and board_id and list_name):
            return self.create_text_message("Missing required parameters: API key, token, board ID, or list name.")

        url = f"https://api.trello.com/1/boards/{board_id}/lists"
        params = {"name": list_name, "key": api_key, "token": token}

        try:
            response = requests.post(url, params=params)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to create list")

        new_list = response.json()
        return self.create_text_message(
            text=f"List '{new_list['name']}' created successfully with Id {new_list['id']} on board {board_id}."
        )

from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetListsFromBoardTool(BuiltinTool):
    """
    Tool for retrieving all lists from a specified Trello board by its ID.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]) -> ToolInvokeMessage:
        """
        Invoke the tool to get all lists from a specified Trello board.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool]]): The parameters for the tool invocation,
             including the board ID.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")
        board_id = tool_parameters.get("boardId")

        if not (api_key and token and board_id):
            return self.create_text_message("Missing required parameters: API key, token, or board ID.")

        url = f"https://api.trello.com/1/boards/{board_id}/lists?key={api_key}&token={token}"

        try:
            response = requests.get(url)
            response.raise_for_status()
            lists = response.json()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to retrieve lists")

        lists_info = "\n".join([f"{list['name']} (ID: {list['id']})" for list in lists])
        return self.create_text_message(text=f"Lists on Board ID {board_id}:\n{lists_info}")

from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DeleteBoardTool(BuiltinTool):
    """
    Tool for deleting a Trello board by ID.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]) -> ToolInvokeMessage:
        """
        Invoke the tool to delete a Trello board by its ID.

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

        url = f"https://api.trello.com/1/boards/{board_id}?key={api_key}&token={token}"

        try:
            response = requests.delete(url)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to delete board")

        return self.create_text_message(text=f"Board with ID {board_id} deleted successfully.")

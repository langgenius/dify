from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class UpdateBoardByIdTool(BuiltinTool):
    """
    Tool for updating a Trello board by its ID with various parameters.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool, None]]) -> ToolInvokeMessage:
        """
        Invoke the tool to update a Trello board by its ID.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool, None]]): The parameters for the tool invocation,
             including board ID and updates.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")
        board_id = tool_parameters.pop("boardId", None)

        if not (api_key and token and board_id):
            return self.create_text_message("Missing required parameters: API key, token, or board ID.")

        url = f"https://api.trello.com/1/boards/{board_id}"

        # Removing parameters not intended for update action or with None value
        params = {k: v for k, v in tool_parameters.items() if v is not None}
        params["key"] = api_key
        params["token"] = token

        try:
            response = requests.put(url, params=params)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to update board")

        updated_board = response.json()
        return self.create_text_message(text=f"Board '{updated_board['name']}' updated successfully.")

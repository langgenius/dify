from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CreateNewCardOnBoardTool(BuiltinTool):
    """
    Tool for creating a new card on a Trello board.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool, None]]) -> ToolInvokeMessage:
        """
        Invoke the tool to create a new card on a Trello board.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool, None]]): The parameters for the tool invocation,
             including details for the new card.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")

        # Ensure required parameters are present
        if "name" not in tool_parameters or "idList" not in tool_parameters:
            return self.create_text_message("Missing required parameters: name or idList.")

        url = "https://api.trello.com/1/cards"
        params = {**tool_parameters, "key": api_key, "token": token}

        try:
            response = requests.post(url, params=params)
            response.raise_for_status()
            new_card = response.json()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to create card")

        return self.create_text_message(
            text=f"New card '{new_card['name']}' created successfully with ID {new_card['id']}."
        )

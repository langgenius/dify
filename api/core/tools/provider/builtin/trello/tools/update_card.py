from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class UpdateCardByIdTool(BuiltinTool):
    """
    Tool for updating a Trello card by its ID.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool, None]]) -> ToolInvokeMessage:
        """
        Invoke the tool to update a Trello card by its ID.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool, None]]): The parameters for the tool invocation,
             including the card ID and updates.

        Returns:
            ToolInvokeMessage: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")
        card_id = tool_parameters.get("id")

        if not (api_key and token and card_id):
            return self.create_text_message("Missing required parameters: API key, token, or card ID.")

        # Constructing the URL and the payload for the PUT request
        url = f"https://api.trello.com/1/cards/{card_id}"
        params = {k: v for k, v in tool_parameters.items() if v is not None and k != "id"}
        params.update({"key": api_key, "token": token})

        try:
            response = requests.put(url, params=params)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to update card")

        updated_card_info = f"Card '{card_id}' updated successfully."
        return self.create_text_message(text=updated_card_info)

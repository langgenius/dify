from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetBoardByIdTool(BuiltinTool):
    """
    Tool for retrieving detailed information about a Trello board by its ID.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]) -> ToolInvokeMessage:
        """
        Invoke the tool to retrieve a Trello board by its ID.

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
            response = requests.get(url)
            response.raise_for_status()
            board = response.json()
            board_details = self.format_board_details(board)
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to retrieve board")

        return self.create_text_message(text=board_details)

    def format_board_details(self, board: dict) -> str:
        """
        Format the board details into a human-readable string.

        Args:
            board (dict): The board information as a dictionary.

        Returns:
            str: Formatted board details.
        """
        details = (
            f"Board Name: {board['name']}\n"
            f"Board ID: {board['id']}\n"
            f"Description: {board['desc'] or 'No description provided.'}\n"
            f"Status: {'Closed' if board['closed'] else 'Open'}\n"
            f"Organization ID: {board['idOrganization'] or 'Not part of an organization.'}\n"
            f"URL: {board['url']}\n"
            f"Short URL: {board['shortUrl']}\n"
            f"Permission Level: {board['prefs']['permissionLevel']}\n"
            f"Background Color: {board['prefs']['backgroundColor']}"
        )
        return details

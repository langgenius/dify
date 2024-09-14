from typing import Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class FetchAllBoardsTool(BuiltinTool):
    """
    Tool for fetching all boards from Trello.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Union[str, int, bool]]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the fetch all boards tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Union[str, int, bool]]): The parameters for the tool invocation.

        Returns:
            Union[ToolInvokeMessage, List[ToolInvokeMessage]]: The result of the tool invocation.
        """
        api_key = self.runtime.credentials.get("trello_api_key")
        token = self.runtime.credentials.get("trello_api_token")

        if not (api_key and token):
            return self.create_text_message("Missing Trello API key or token in credentials.")

        # Including board filter in the request if provided
        board_filter = tool_parameters.get("boards", "open")
        url = f"https://api.trello.com/1/members/me/boards?filter={board_filter}&key={api_key}&token={token}"

        try:
            response = requests.get(url)
            response.raise_for_status()  # Raises stored HTTPError, if one occurred.
        except requests.exceptions.RequestException as e:
            return self.create_text_message("Failed to fetch boards")

        boards = response.json()

        if not boards:
            return self.create_text_message("No boards found in Trello.")

        # Creating a string with both board names and IDs
        boards_info = ", ".join([f"{board['name']} (ID: {board['id']})" for board in boards])
        return self.create_text_message(text=f"Boards: {boards_info}")

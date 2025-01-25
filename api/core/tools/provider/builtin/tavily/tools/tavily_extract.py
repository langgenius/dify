from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

TAVILY_API_URL = "https://api.tavily.com"


class TavilyExtract:
    """
    A class for extracting content from web pages using the Tavily Extract API.

    Args:
        api_key (str): The API key for accessing the Tavily Extract API.

    Methods:
        extract_content: Retrieves extracted content from the Tavily Extract API.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def extract_content(self, params: dict[str, Any]) -> dict:
        """
        Retrieves extracted content from the Tavily Extract API.

        Args:
            params (Dict[str, Any]): The extraction parameters.

        Returns:
            dict: The extracted content.

        """
        # Ensure required parameters are set
        if "api_key" not in params:
            params["api_key"] = self.api_key

        # Process parameters
        processed_params = self._process_params(params)

        response = requests.post(f"{TAVILY_API_URL}/extract", json=processed_params)
        response.raise_for_status()
        return response.json()

    def _process_params(self, params: dict[str, Any]) -> dict:
        """
        Processes and validates the extraction parameters.

        Args:
            params (Dict[str, Any]): The extraction parameters.

        Returns:
            dict: The processed parameters.
        """
        processed_params = {}

        # Process 'urls'
        if "urls" in params:
            urls = params["urls"]
            if isinstance(urls, str):
                processed_params["urls"] = [url.strip() for url in urls.replace(",", " ").split()]
            elif isinstance(urls, list):
                processed_params["urls"] = urls
        else:
            raise ValueError("The 'urls' parameter is required.")

        # Only include 'api_key'
        processed_params["api_key"] = params.get("api_key", self.api_key)

        return processed_params


class TavilyExtractTool(BuiltinTool):
    """
    A tool for extracting content from web pages using Tavily Extract.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invokes the Tavily Extract tool with the given user ID and tool parameters.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (Dict[str, Any]): The parameters for the Tavily Extract tool.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the Tavily Extract tool invocation.
        """
        urls = tool_parameters.get("urls", "")
        api_key = self.runtime.credentials.get("tavily_api_key")
        if not api_key:
            return self.create_text_message(
                "Tavily API key is missing. Please set the 'tavily_api_key' in credentials."
            )
        if not urls:
            return self.create_text_message("Please input at least one URL to extract.")

        tavily_extract = TavilyExtract(api_key)
        try:
            raw_results = tavily_extract.extract_content(tool_parameters)
        except requests.HTTPError as e:
            return self.create_text_message(f"Error occurred while extracting content: {str(e)}")

        if not raw_results.get("results"):
            return self.create_text_message("No content could be extracted from the provided URLs.")
        else:
            # Always return JSON message with all data
            json_message = self.create_json_message(raw_results)

            # Create text message based on user-selected parameters
            text_message_content = self._format_results_as_text(raw_results)
            text_message = self.create_text_message(text=text_message_content)

            return [json_message, text_message]

    def _format_results_as_text(self, raw_results: dict) -> str:
        """
        Formats the raw extraction results into a markdown text based on user-selected parameters.

        Args:
            raw_results (dict): The raw extraction results.

        Returns:
            str: The formatted markdown text.
        """
        output_lines = []

        for idx, result in enumerate(raw_results.get("results", []), 1):
            url = result.get("url", "")
            raw_content = result.get("raw_content", "")

            output_lines.append(f"## Extracted Content {idx}: {url}\n")
            output_lines.append(f"**Raw Content:**\n{raw_content}\n")
            output_lines.append("---\n")

        if raw_results.get("failed_results"):
            output_lines.append("## Failed URLs:\n")
            for failed in raw_results["failed_results"]:
                url = failed.get("url", "")
                error = failed.get("error", "Unknown error")
                output_lines.append(f"- {url}: {error}\n")

        return "\n".join(output_lines)

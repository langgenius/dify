from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

TAVILY_API_URL = "https://api.tavily.com"


class TavilySearch:
    """
    A class for performing search operations using the Tavily Search API.

    Args:
        api_key (str): The API key for accessing the Tavily Search API.

    Methods:
        raw_results: Retrieves raw search results from the Tavily Search API.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def raw_results(self, params: dict[str, Any]) -> dict:
        """
        Retrieves raw search results from the Tavily Search API.

        Args:
            params (Dict[str, Any]): The search parameters.

        Returns:
            dict: The raw search results.

        """
        # Ensure required parameters are set
        params["api_key"] = self.api_key

        # Process parameters to ensure correct types
        processed_params = self._process_params(params)

        response = requests.post(f"{TAVILY_API_URL}/search", json=processed_params)
        response.raise_for_status()
        return response.json()

    def _process_params(self, params: dict[str, Any]) -> dict:
        """
        Processes and validates the search parameters.

        Args:
            params (Dict[str, Any]): The search parameters.

        Returns:
            dict: The processed parameters.
        """
        processed_params = {}

        for key, value in params.items():
            if value is None or value == "None":
                continue
            if key in ["include_domains", "exclude_domains"]:
                if isinstance(value, str):
                    # Split the string by commas or spaces and strip whitespace
                    processed_params[key] = [domain.strip() for domain in value.replace(",", " ").split()]
            elif key in ["include_images", "include_image_descriptions", "include_answer", "include_raw_content"]:
                # Ensure boolean type
                if isinstance(value, str):
                    processed_params[key] = value.lower() == "true"
                else:
                    processed_params[key] = bool(value)
            elif key in ["max_results", "days"]:
                if isinstance(value, str):
                    processed_params[key] = int(value)
                else:
                    processed_params[key] = value
            elif key in ["search_depth", "topic", "query", "api_key"]:
                processed_params[key] = value
            else:
                # Unrecognized parameter
                pass

        # Set defaults if not present
        processed_params.setdefault("search_depth", "basic")
        processed_params.setdefault("topic", "general")
        processed_params.setdefault("max_results", 5)

        # If topic is 'news', ensure 'days' is set
        if processed_params.get("topic") == "news":
            processed_params.setdefault("days", 3)

        return processed_params


class TavilySearchTool(BuiltinTool):
    """
    A tool for searching Tavily using a given query.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invokes the Tavily search tool with the given user ID and tool parameters.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (Dict[str, Any]): The parameters for the Tavily search tool.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the Tavily search tool invocation.
        """
        query = tool_parameters.get("query", "")
        api_key = self.runtime.credentials.get("tavily_api_key")
        if not api_key:
            return self.create_text_message(
                "Tavily API key is missing. Please set the 'tavily_api_key' in credentials."
            )
        if not query:
            return self.create_text_message("Please input a query.")

        tavily_search = TavilySearch(api_key)
        try:
            raw_results = tavily_search.raw_results(tool_parameters)
        except requests.HTTPError as e:
            return self.create_text_message(f"Error occurred while searching: {str(e)}")

        if not raw_results.get("results"):
            return self.create_text_message(f"No results found for '{query}' in Tavily.")
        else:
            # Always return JSON message with all data
            json_message = self.create_json_message(raw_results)

            # Create text message based on user-selected parameters
            text_message_content = self._format_results_as_text(raw_results, tool_parameters)
            text_message = self.create_text_message(text=text_message_content)

            return [json_message, text_message]

    def _format_results_as_text(self, raw_results: dict, tool_parameters: dict[str, Any]) -> str:
        """
        Formats the raw results into a markdown text based on user-selected parameters.

        Args:
            raw_results (dict): The raw search results.
            tool_parameters (dict): The tool parameters selected by the user.

        Returns:
            str: The formatted markdown text.
        """
        output_lines = []

        # Include answer if requested
        if tool_parameters.get("include_answer", False) and raw_results.get("answer"):
            output_lines.append(f"**Answer:** {raw_results['answer']}\n")

        # Include images if requested
        if tool_parameters.get("include_images", False) and raw_results.get("images"):
            output_lines.append("**Images:**\n")
            for image in raw_results["images"]:
                if tool_parameters.get("include_image_descriptions", False) and "description" in image:
                    output_lines.append(f"![{image['description']}]({image['url']})\n")
                else:
                    output_lines.append(f"![]({image['url']})\n")

        # Process each result
        if "results" in raw_results:
            for idx, result in enumerate(raw_results["results"], 1):
                title = result.get("title", "No Title")
                url = result.get("url", "")
                content = result.get("content", "")
                published_date = result.get("published_date", "")
                score = result.get("score", "")

                output_lines.append(f"### Result {idx}: [{title}]({url})\n")

                # Include published date if available and topic is 'news'
                if tool_parameters.get("topic") == "news" and published_date:
                    output_lines.append(f"**Published Date:** {published_date}\n")

                output_lines.append(f"**URL:** {url}\n")

                # Include score (relevance)
                if score:
                    output_lines.append(f"**Relevance Score:** {score}\n")

                # Include content
                if content:
                    output_lines.append(f"**Content:**\n{content}\n")

                # Include raw content if requested
                if tool_parameters.get("include_raw_content", False) and result.get("raw_content"):
                    output_lines.append(f"**Raw Content:**\n{result['raw_content']}\n")

                # Add a separator
                output_lines.append("---\n")

        return "\n".join(output_lines)

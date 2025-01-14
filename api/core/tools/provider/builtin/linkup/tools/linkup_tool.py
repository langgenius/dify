from linkup import LinkupClient
from pydantic import PrivateAttr

class LinkupSearchTool:
    name: str = "Linkup Search Tool"
    description: str = "Performs an API call to Linkup to retrieve contextual information."
    _client: LinkupClient = PrivateAttr()

    def __init__(self, api_key: str):
        """
        Initialize the tool with an API key.
        """
        self._client = LinkupClient(api_key=api_key)

    def _run(self, query: str, depth: str, output_type: str, structured_output_schema: dict = None) -> dict:
        """
        Executes a search using the Linkup API.

        :param query: The query to search for.
        :param depth: Search depth (default is "standard").
        :param output_type: Desired result type (default is "searchResults").
        :param structured_output_schema: JSON schema for structured output (only used if output_type is "structured").
        :return: A dictionary containing the results or an error message.
        """
        try:
            if output_type == "structured" and structured_output_schema:
                response = self._client.search(
                    query=query,
                    depth=depth,
                    output_type=output_type,
                    structured_output_schema=structured_output_schema
                )
            else:
                response = self._client.search(
                    query=query,
                    depth=depth,
                    output_type=output_type
                )
            if output_type == "structured" :
                return response
            else:
                return {"success": True, **vars(response)}
        except Exception as e:
            return {"success": False, "error": str(e)}


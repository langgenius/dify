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

    def _run(self, query: str, depth: str = "standard", output_type: str = "searchResults") -> dict:
        """
        Executes a search using the Linkup API.

        :param query: The query to search for.
        :param depth: Search depth (default is "standard").
        :param output_type: Desired result type (default is "searchResults").
        :return: A dictionary containing the results or an error message.
        """
        try:
            response = self._client.search(
                query=query,
                depth=depth,
                output_type=output_type
            )
            results = [
                {"name": result.name, "url": result.url, "content": result.content}
                for result in response.results
            ]
            return {"success": True, "results": results}
        except Exception as e:
            return {"success": False, "error": str(e)}

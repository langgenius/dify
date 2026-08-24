from typing import Any, Dict, List, Union
import requests

try:
    from core.tools.entities.tool_entities import ToolInvokeMessage
    from core.tools.tool.builtin_tool import BuiltinTool
except ImportError:
    class BuiltinTool:  # type: ignore
        pass

    class ToolInvokeMessage:  # type: ignore
        @classmethod
        def create_text_message(cls, text: str):
            return {"type": "text", "message": text}

        @classmethod
        def create_json_message(cls, data: dict):
            return {"type": "json", "message": data}


class AnnoluxSearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: Dict[str, Any],
    ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """Invoke the Annolux search tool."""
        api_key = self.runtime.credentials.get("api_key")
        if not api_key:
            return self.create_text_message("Error: Annolux API key not configured in provider credentials.")

        query = tool_parameters.get("query")
        if not query:
            return self.create_text_message("Error: query parameter is required.")

        limit = tool_parameters.get("limit", 5)
        domains_str = tool_parameters.get("domains", "")

        payload: Dict[str, Any] = {
            "query": query,
            "limit": min(max(1, int(limit)), 10),
            "deduplicate": True,
            "ranking": "default",
        }
        if domains_str and domains_str.strip():
            payload["domains"] = [d.strip() for d in domains_str.split(",") if d.strip()]

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "dify-builtin-annolux/0.1.0",
        }

        try:
            response = requests.post(
                "https://api.annolux.com/v1/search",
                headers=headers,
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            return self.create_text_message(f"Annolux Search API Error: {str(e)}")

        results = data.get("results", [])
        if not results:
            return self.create_text_message(f"No results found on Annolux for query: {query}")

        return [
            self.create_json_message({
                "results": [
                    {
                        "title": r.get("title", ""),
                        "url": r.get("url", ""),
                        "snippet": r.get("snippet", ""),
                        "fetched_at": r.get("fetched_at", ""),
                        "domain": r.get("domain", ""),
                    }
                    for r in results
                ]
            })
        ]

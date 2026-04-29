from __future__ import annotations

from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

PERPLEXITY_SEARCH_URL = "https://api.perplexity.ai/search"
DEFAULT_MAX_RESULTS = 5
HTTP_TIMEOUT = 30


def _split_domains(value: str) -> list[str]:
    return [d.strip() for d in value.replace(",", " ").split() if d.strip()]


def _build_payload(tool_parameters: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": tool_parameters["query"]}

    max_results = tool_parameters.get("max_results")
    if max_results in (None, ""):
        max_results = DEFAULT_MAX_RESULTS
    try:
        payload["max_results"] = int(max_results)
    except (TypeError, ValueError):
        payload["max_results"] = DEFAULT_MAX_RESULTS

    domain_filter = tool_parameters.get("search_domain_filter")
    if isinstance(domain_filter, str) and domain_filter.strip():
        domains = _split_domains(domain_filter)
        if domains:
            payload["search_domain_filter"] = domains
    elif isinstance(domain_filter, list):
        domains = [str(d).strip() for d in domain_filter if str(d).strip()]
        if domains:
            payload["search_domain_filter"] = domains

    for key in (
        "search_recency_filter",
        "search_after_date_filter",
        "search_before_date_filter",
    ):
        value = tool_parameters.get(key)
        if isinstance(value, str) and value.strip():
            payload[key] = value.strip()

    return payload


class PerplexitySearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        query = (tool_parameters.get("query") or "").strip()
        if not query:
            yield self.create_text_message("Please input a query.")
            return

        api_key = (self.runtime.credentials or {}).get("perplexity_api_key") if self.runtime else None
        if not api_key:
            yield self.create_text_message(
                "Perplexity API key is missing. Please set 'perplexity_api_key' in credentials."
            )
            return

        payload = _build_payload({**tool_parameters, "query": query})

        try:
            response = requests.post(
                PERPLEXITY_SEARCH_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=HTTP_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
        except requests.HTTPError as e:
            raise ToolInvokeError(f"Perplexity Search request failed: {e}") from e
        except requests.RequestException as e:
            raise ToolInvokeError(f"Perplexity Search request error: {e}") from e
        except ValueError as e:
            raise ToolInvokeError(f"Perplexity Search returned invalid JSON: {e}") from e

        results = data.get("results") or []
        if not results:
            yield self.create_text_message(f"No results found for '{query}'.")
            return

        yield self.create_json_message(data)

        for result in results:
            url = result.get("url")
            if isinstance(url, str) and url:
                yield self.create_link_message(url)

        yield self.create_text_message(self._format_results_as_text(results))

    @staticmethod
    def _format_results_as_text(results: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for idx, result in enumerate(results, 1):
            title = result.get("title") or "Untitled"
            url = result.get("url") or ""
            snippet = result.get("snippet") or ""
            date = result.get("date") or ""

            lines.append(f"### Result {idx}: [{title}]({url})")
            if date:
                lines.append(f"**Date:** {date}")
            if url:
                lines.append(f"**URL:** {url}")
            if snippet:
                lines.append(f"{snippet}")
            lines.append("---")
        return "\n".join(lines)

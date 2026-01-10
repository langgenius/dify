from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataSerpClient, AceDataSerpError


class SerpGoogleTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        query = tool_parameters.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ValueError("`query` is required.")

        type_ = tool_parameters.get("type")
        type_ = type_.strip() if isinstance(type_, str) and type_.strip() else None

        country = tool_parameters.get("country")
        country = country.strip() if isinstance(country, str) and country.strip() else None

        language = tool_parameters.get("language")
        language = language.strip() if isinstance(language, str) and language.strip() else None

        date_range = tool_parameters.get("range")
        date_range = (
            date_range.strip() if isinstance(date_range, str) and date_range.strip() else None
        )

        number = tool_parameters.get("number")
        if number is not None:
            try:
                number = int(number)
            except (TypeError, ValueError) as e:
                raise ValueError("`number` must be an integer.") from e
            if number < 1:
                raise ValueError("`number` must be >= 1.")

        page = tool_parameters.get("page")
        if page is not None:
            try:
                page = int(page)
            except (TypeError, ValueError) as e:
                raise ValueError("`page` must be an integer.") from e
            if page < 1:
                raise ValueError("`page` must be >= 1.")

        client = AceDataSerpClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.google(
                query=query.strip(),
                type=type_,
                country=country,
                language=language,
                range=date_range,
                number=number,
                page=page,
                timeout_s=60,
            )
        except AceDataSerpError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)


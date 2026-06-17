"""Dify knowledge-base layer exposing one model-visible search tool.

The layer depends on ``DifyExecutionContextLayer`` for tenant/app/user/invoke
identity, keeps retrieval controls in config only, and borrows a lifespan-owned
HTTP client for each tool invocation. It never owns live clients or stores
retrieved source content in layer state. Tool identity is intentionally fixed at
runtime: callers cannot rename the knowledge tool or override its description
through public layer config because the model-visible surface must stay stable
across API-side Agent Soul mappings.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import ClassVar, cast

import httpx
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition
from typing_extensions import Self, override

from agenton.layers import LayerDeps, PlainLayer
from dify_agent.layers.execution_context.layer import DifyExecutionContextLayer
from dify_agent.layers.knowledge.client import (
    DifyKnowledgeBaseClient,
    DifyKnowledgeBaseClientError,
    DifyKnowledgeRetrieveResponse,
)
from dify_agent.layers.knowledge.configs import DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID, DifyKnowledgeBaseLayerConfig

logger = logging.getLogger(__name__)

# Fixed model-visible tool identity. These stay module-private on purpose so the
# public DTO cannot grow a parallel naming contract that diverges from the
# runtime knowledge-search surface.
_KNOWLEDGE_BASE_TOOL_NAME = "knowledge_base_search"
_KNOWLEDGE_BASE_TOOL_DESCRIPTION = "Search configured knowledge bases for information relevant to the query."
BLANK_QUERY_OBSERVATION = "knowledge base search requires a non-empty query"
NO_RESULTS_OBSERVATION = "No relevant knowledge base results were found."
TEMPORARY_UNAVAILABLE_OBSERVATION = (
    "Knowledge base search is temporarily unavailable. Please continue without it if possible."
)
QUERY_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search query for the configured knowledge bases.",
        }
    },
    "required": ["query"],
    "additionalProperties": False,
}


class DifyKnowledgeBaseDeps(LayerDeps):
    """Dependencies required by ``DifyKnowledgeBaseLayer``."""

    execution_context: DifyExecutionContextLayer  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyKnowledgeBaseLayer(PlainLayer[DifyKnowledgeBaseDeps, DifyKnowledgeBaseLayerConfig]):
    """Layer that resolves one config-scoped knowledge search tool."""

    type_id: ClassVar[str | None] = DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID

    config: DifyKnowledgeBaseLayerConfig
    dify_api_inner_url: str
    dify_api_inner_api_key: str

    @classmethod
    @override
    def from_config(cls, config: DifyKnowledgeBaseLayerConfig) -> Self:
        """Reject construction without server-injected Dify API settings."""
        del config
        raise TypeError(
            "DifyKnowledgeBaseLayer requires server-side Dify API settings and must use a provider factory."
        )

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyKnowledgeBaseLayerConfig,
        *,
        dify_api_inner_url: str,
        dify_api_inner_api_key: str,
    ) -> Self:
        """Create the layer from public config plus server-only API settings."""
        return cls(
            config=DifyKnowledgeBaseLayerConfig.model_validate(config),
            dify_api_inner_url=dify_api_inner_url,
            dify_api_inner_api_key=dify_api_inner_api_key,
        )

    async def get_tools(self, *, http_client: httpx.AsyncClient) -> list[Tool[object]]:
        """Build one Pydantic AI tool that exposes only ``query`` to the model.

        Knowledge tools depend on execution-context identity that is optional for
        other run types but mandatory here: ``tenant_id``, ``user_id``,
        ``user_from``, ``app_id``, and ``invoke_from`` must all be present before
        any HTTP request is attempted. Tool execution then follows a strict
        observation policy:

        - blank ``query`` returns a local validation observation;
        - retryable client failures (timeouts, connection failures, HTTP
          ``429``/``502``) become a temporary-unavailable observation;
        - non-retryable client failures are raised so the run fails fast.
        """
        if http_client.is_closed:
            raise RuntimeError("DifyKnowledgeBaseLayer.get_tools() requires an open shared HTTP client.")

        execution_context = self.deps.execution_context.config
        caller = _build_caller_context(execution_context)
        client = DifyKnowledgeBaseClient(
            base_url=self.dify_api_inner_url,
            api_key=self.dify_api_inner_api_key,
            http_client=http_client,
        )

        async def knowledge_base_search(_ctx: RunContext[object], query: str) -> str:
            normalized_query = query.strip()
            if not normalized_query:
                return BLANK_QUERY_OBSERVATION
            try:
                response = await client.retrieve(
                    tenant_id=caller["tenant_id"],
                    user_id=caller["user_id"],
                    app_id=caller["app_id"],
                    user_from=caller["user_from"],
                    invoke_from=caller["invoke_from"],
                    dataset_ids=list(self.config.dataset_ids),
                    query=normalized_query,
                    retrieval=self.config.retrieval,
                    metadata_filtering=self.config.metadata_filtering,
                )
            except DifyKnowledgeBaseClientError as exc:
                if exc.retryable:
                    logger.warning(
                        "knowledge base search temporarily unavailable",
                        extra={
                            "tenant_id": caller["tenant_id"],
                            "app_id": caller["app_id"],
                            "invoke_from": caller["invoke_from"],
                            "error_code": exc.error_code,
                            "status_code": exc.status_code,
                        },
                    )
                    return TEMPORARY_UNAVAILABLE_OBSERVATION
                logger.error(
                    "knowledge base search failed",
                    extra={
                        "tenant_id": caller["tenant_id"],
                        "app_id": caller["app_id"],
                        "invoke_from": caller["invoke_from"],
                        "error_code": exc.error_code,
                        "status_code": exc.status_code,
                    },
                )
                raise
            return _format_observation(response, self.config)

        async def prepare_tool_definition(_ctx: RunContext[object], tool_def: ToolDefinition) -> ToolDefinition:
            return ToolDefinition(
                name=tool_def.name,
                description=tool_def.description,
                parameters_json_schema=QUERY_TOOL_SCHEMA,
                strict=tool_def.strict,
                sequential=tool_def.sequential,
                metadata=tool_def.metadata,
                timeout=tool_def.timeout,
                defer_loading=tool_def.defer_loading,
                kind=tool_def.kind,
                return_schema=tool_def.return_schema,
                include_return_schema=tool_def.include_return_schema,
            )

        return [
            Tool(
                knowledge_base_search,
                takes_ctx=True,
                name=_KNOWLEDGE_BASE_TOOL_NAME,
                description=_KNOWLEDGE_BASE_TOOL_DESCRIPTION,
                prepare=prepare_tool_definition,
            )
        ]


def _build_caller_context(execution_context: object) -> dict[str, str]:
    """Extract the inner-API caller identity from execution-context config.

    The public execution-context DTO keeps several fields optional for general
    runs, but knowledge retrieval requires all of ``tenant_id``, ``user_id``,
    ``user_from``, ``app_id``, and ``invoke_from``. Missing or blank values are
    rejected here so misconfigured runs fail before transport rather than being
    softened into tool observations.
    """
    tenant_id = getattr(execution_context, "tenant_id", None)
    user_id = getattr(execution_context, "user_id", None)
    user_from = getattr(execution_context, "user_from", None)
    app_id = getattr(execution_context, "app_id", None)
    invoke_from = getattr(execution_context, "invoke_from", None)

    missing_fields = [
        field_name
        for field_name, value in (
            ("tenant_id", tenant_id),
            ("user_id", user_id),
            ("user_from", user_from),
            ("app_id", app_id),
            ("invoke_from", invoke_from),
        )
        if not isinstance(value, str) or not value.strip()
    ]
    if missing_fields:
        joined_fields = ", ".join(missing_fields)
        raise ValueError(f"Dify knowledge base layer requires execution context fields: {joined_fields}")

    normalized_tenant_id = cast(str, tenant_id).strip()
    normalized_user_id = cast(str, user_id).strip()
    normalized_user_from = cast(str, user_from).strip()
    normalized_app_id = cast(str, app_id).strip()
    normalized_invoke_from = cast(str, invoke_from).strip()

    return {
        "tenant_id": normalized_tenant_id,
        "user_id": normalized_user_id,
        "user_from": normalized_user_from,
        "app_id": normalized_app_id,
        "invoke_from": normalized_invoke_from,
    }


def _format_observation(response: DifyKnowledgeRetrieveResponse, config: DifyKnowledgeBaseLayerConfig) -> str:
    """Render inner-API retrieval results into the model-visible tool response.

    The formatting contract is intentionally simple and stable for the model:

    - empty ``results`` returns ``NO_RESULTS_OBSERVATION``;
    - non-empty results become a numbered list headed by
      ``"Knowledge base search results:"``;
    - each item includes title plus dataset/document/score metadata when those
      fields are present;
    - each content snippet is truncated by ``max_result_content_chars``;
    - the final observation is truncated by ``max_observation_chars``.
    """
    if not response.results:
        return NO_RESULTS_OBSERVATION

    lines = ["Knowledge base search results:"]
    for index, result in enumerate(response.results, start=1):
        metadata = result.metadata
        title = result.title or metadata.document_name or "Untitled"
        lines.append(f"{index}. Title: {title}")
        if metadata.dataset_name:
            lines.append(f"   Dataset: {metadata.dataset_name}")
        if metadata.document_name:
            lines.append(f"   Document: {metadata.document_name}")
        if metadata.score is not None:
            lines.append(f"   Score: {metadata.score}")
        content = _truncate_text(result.content or result.summary or "", config.max_result_content_chars)
        if content:
            lines.append(f"   Content: {content}")
        lines.append("")

    return _truncate_text("\n".join(lines).rstrip(), config.max_observation_chars)


def _truncate_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return f"{text[: max_chars - 3]}..."


__all__ = [
    "BLANK_QUERY_OBSERVATION",
    "DifyKnowledgeBaseDeps",
    "DifyKnowledgeBaseLayer",
    "NO_RESULTS_OBSERVATION",
    "QUERY_TOOL_SCHEMA",
    "TEMPORARY_UNAVAILABLE_OBSERVATION",
]

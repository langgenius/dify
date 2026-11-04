"""Dify knowledge-base layer exposing set-aware retrieval.

The layer depends on ``execution-context Config`` for tenant/app/user/invoke
identity. Generated-query sets become one stable model-visible
``knowledge_base_search(set_name, query)`` tool, while user-query sets are
retrieved eagerly during context entry and exposed as additional user prompt
content. Eager observations are persisted only as JSON-safe runtime state so
session snapshots can resume without repeating unchanged retrievals.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import json
import logging
from typing import cast, override

import httpx
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolDefinition

from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.capabilities.abstract import WrapRunHandler
from pydantic_ai.run import AgentRunResult
from pydantic_ai.toolsets import FunctionToolset
from pydantic_ai.models import ModelRequestContext
from pydantic_ai.messages import ModelRequest, UserPromptPart
from dify_agent.runtime.context import Deps
from dify_agent.layers.execution_context.layer import Config as ExecutionContextConfig
from dify_agent.layers.knowledge.client import (
    DifyKnowledgeBaseClient,
    DifyKnowledgeBaseClientError,
    DifyKnowledgeRetrieveResponse,
)
from dify_agent.layers.knowledge.configs import (
    DifyKnowledgeBaseLayerConfig,
    DifyKnowledgeEagerResult,
    DifyKnowledgeRuntimeState,
    DifyKnowledgeSetConfig,
)

logger = logging.getLogger(__name__)

# Fixed model-visible tool identity. These stay module-private on purpose so the
# public DTO cannot grow a parallel naming contract that diverges from the
# runtime knowledge-search surface.
_KNOWLEDGE_BASE_TOOL_NAME = "knowledge_base_search"
_KNOWLEDGE_BASE_TOOL_DESCRIPTION = (
    "Search a configured knowledge set. Pick one configured set_name and provide a focused search query."
)
BLANK_QUERY_OBSERVATION = "knowledge base search requires a non-empty query"
NO_RESULTS_OBSERVATION = "No relevant knowledge base results were found."
TEMPORARY_UNAVAILABLE_OBSERVATION = (
    "Knowledge base search is temporarily unavailable. Please continue without it if possible."
)


class Config(DifyKnowledgeBaseLayerConfig):
    pass


class State(DifyKnowledgeRuntimeState):
    pass


class Capability(AbstractCapability[Deps]):
    """Eager retrieval and user-context injection plus generated-query tools."""

    def __init__(self, name: str):
        self.id = name
        self.name = name
        self._injected = False

    @override
    def get_toolset(self) -> FunctionToolset[Deps]:
        return _KnowledgeTools(self.name)

    def provides_user_content(self, deps: Deps) -> bool:
        """User-query retrieval supplies meaningful user input before the model."""
        config = Config.model_validate(deps.layers[self.name]["config"])
        return any(knowledge_set.query.mode == "user_query" for knowledge_set in config.sets)

    @override
    async def wrap_run(self, ctx: RunContext[Deps], *, handler: WrapRunHandler) -> AgentRunResult:
        await _KnowledgeOperations(self.name, ctx.deps)._refresh_eager_results_if_needed()
        return await handler()

    @override
    async def before_model_request(
        self, ctx: RunContext[Deps], request_context: ModelRequestContext
    ) -> ModelRequestContext:
        if not self._injected and ctx.prompt is not None:
            self._injected = True
            prompts = _KnowledgeOperations(self.name, ctx.deps).user_prompts
            if prompts:
                # Keep retrieval in the user role and in captured conversation history.
                request_context.messages.append(ModelRequest(parts=[UserPromptPart(content="\n\n".join(prompts))]))
        return request_context


class _KnowledgeTools(FunctionToolset[Deps]):
    def __init__(self, name: str):
        super().__init__(id=name)
        self.name = name
        self._loaded = False

    @override
    async def get_tools(self, ctx: RunContext[Deps]):
        if not self._loaded:
            for tool in await _KnowledgeOperations(self.name, ctx.deps).build_tools(
                http_client=ctx.deps.services.dify_api_http_client
            ):
                self.add_tool(tool)
            self._loaded = True
        return await super().get_tools(ctx)


@dataclass
class _KnowledgeOperations:
    """Request-scoped retrieval operations; JSON holds all cached state."""

    name: str
    deps: Deps

    @property
    def config(self) -> Config:
        return Config.model_validate(self.deps.layers[self.name]["config"])

    @property
    def runtime_state(self) -> State:
        return State.model_validate(self.deps.layers[self.name]["state"])

    @property
    def execution_context(self) -> ExecutionContextConfig:
        return ExecutionContextConfig.model_validate(self.deps.layers[self.config.execution_context]["config"])

    @property
    def inner_api_url(self) -> str:
        return self.deps.services.inner_api_url

    @property
    def inner_api_key(self) -> str:
        return self.deps.services.inner_api_key

    async def build_tools(self, *, http_client: httpx.AsyncClient) -> list[Tool[Deps]]:
        """Build the unified generated-query Pydantic AI tool, when needed.

        Knowledge tools depend on execution-context identity that is optional for
        other run types but mandatory here: ``tenant_id``, ``user_id``,
        ``user_from``, ``app_id``, and ``invoke_from`` must all be present before
        any HTTP request is attempted. Tool execution then follows a strict
        observation policy:

        - unknown ``set_name`` returns a local validation observation;
        - blank ``query`` returns a local validation observation;
        - retryable client failures (timeouts, connection failures, HTTP
          ``429``/``502``) become a temporary-unavailable observation;
        - non-retryable client failures are raised so the run fails fast.
        """
        generated_sets = self._generated_query_sets()
        if not generated_sets:
            return []
        if http_client.is_closed:
            raise RuntimeError("DifyKnowledgeBaseLayer.get_tools() requires an open shared HTTP client.")

        execution_context = self.execution_context
        caller = _build_caller_context(execution_context)
        client = DifyKnowledgeBaseClient(
            base_url=self.inner_api_url,
            api_key=self.inner_api_key,
            http_client=http_client,
        )
        set_by_name = {knowledge_set.name: knowledge_set for knowledge_set in generated_sets}

        async def knowledge_base_search(_ctx: RunContext[Deps], set_name: str, query: str) -> str:
            knowledge_set = set_by_name.get(set_name)
            if knowledge_set is None:
                return f"unknown knowledge set: {set_name}"
            normalized_query = query.strip()
            if not normalized_query:
                return BLANK_QUERY_OBSERVATION
            return await self._retrieve_for_set(
                client=client,
                caller=caller,
                knowledge_set=knowledge_set,
                query=normalized_query,
                retryable_observation=True,
            )

        async def prepare_tool_definition(_ctx: RunContext[Deps], tool_def: ToolDefinition) -> ToolDefinition:
            return replace(tool_def, parameters_json_schema=_tool_schema(generated_sets))

        return [
            Tool(
                knowledge_base_search,
                takes_ctx=True,
                name=_KNOWLEDGE_BASE_TOOL_NAME,
                description=_tool_description(generated_sets),
                prepare=prepare_tool_definition,
            )
        ]

    @property
    def user_prompts(self) -> list[str]:
        """Expose eager user-query results as an additional user prompt."""
        if not self.runtime_state.eager_results:
            return []

        sections: list[str] = []
        for result in self.runtime_state.eager_results:
            sections.append(
                "\n".join(
                    [
                        f"Set: {result.set_name}",
                        f"Query: {result.query}",
                        "Results:",
                        result.observation,
                    ]
                )
            )
        return ["Knowledge retrieval results:\n\n" + "\n\n".join(sections)]

    def _generated_query_sets(self) -> list[DifyKnowledgeSetConfig]:
        return [knowledge_set for knowledge_set in self.config.sets if knowledge_set.query.mode == "generated_query"]

    def _user_query_sets(self) -> list[DifyKnowledgeSetConfig]:
        return [knowledge_set for knowledge_set in self.config.sets if knowledge_set.query.mode == "user_query"]

    async def _refresh_eager_results_if_needed(self) -> None:
        user_query_sets = self._user_query_sets()
        if not user_query_sets:
            self.deps.layers[self.name]["state"] = State().model_dump(mode="json")
            return

        fingerprint = _eager_config_fingerprint(user_query_sets)
        if self.runtime_state.eager_config_fingerprint == fingerprint:
            return

        caller = _build_caller_context(self.execution_context)
        client = DifyKnowledgeBaseClient(
            base_url=self.inner_api_url,
            api_key=self.inner_api_key,
            http_client=self.deps.services.dify_api_http_client,
        )
        eager_results: list[DifyKnowledgeEagerResult] = []
        for knowledge_set in user_query_sets:
            query = (knowledge_set.query.value or "").strip()
            try:
                response = await client.retrieve(
                    tenant_id=caller["tenant_id"],
                    user_id=caller["user_id"],
                    app_id=caller["app_id"],
                    user_from=caller["user_from"],
                    invoke_from=caller["invoke_from"],
                    dataset_ids=knowledge_set.dataset_ids,
                    query=query,
                    retrieval=knowledge_set.retrieval,
                    metadata_filtering=knowledge_set.metadata_filtering,
                )
            except DifyKnowledgeBaseClientError as exc:
                if exc.retryable:
                    logger.warning(
                        "eager knowledge retrieval temporarily unavailable",
                        extra={
                            "tenant_id": caller["tenant_id"],
                            "app_id": caller["app_id"],
                            "invoke_from": caller["invoke_from"],
                            "knowledge_set_id": knowledge_set.id,
                            "error_code": exc.error_code,
                            "status_code": exc.status_code,
                            "error_message": str(exc),
                        },
                        exc_info=True,
                    )
                    eager_results.append(
                        DifyKnowledgeEagerResult(
                            set_id=knowledge_set.id,
                            set_name=knowledge_set.name,
                            query=query,
                            observation=TEMPORARY_UNAVAILABLE_OBSERVATION,
                            status="temporarily_unavailable",
                        )
                    )
                    continue
                logger.error(
                    "eager knowledge retrieval failed",
                    extra={
                        "tenant_id": caller["tenant_id"],
                        "app_id": caller["app_id"],
                        "invoke_from": caller["invoke_from"],
                        "knowledge_set_id": knowledge_set.id,
                        "error_code": exc.error_code,
                        "status_code": exc.status_code,
                        "error_message": str(exc),
                    },
                    exc_info=True,
                )
                raise

            eager_results.append(
                DifyKnowledgeEagerResult(
                    set_id=knowledge_set.id,
                    set_name=knowledge_set.name,
                    query=query,
                    observation=_format_observation(response, self.config, include_heading=False),
                    status="success" if response.results else "empty",
                )
            )

        self.deps.layers[self.name]["state"] = State(
            eager_results=eager_results, eager_config_fingerprint=fingerprint
        ).model_dump(mode="json")

    async def _retrieve_for_set(
        self,
        *,
        client: DifyKnowledgeBaseClient,
        caller: dict[str, str],
        knowledge_set: DifyKnowledgeSetConfig,
        query: str,
        retryable_observation: bool,
    ) -> str:
        try:
            response = await client.retrieve(
                tenant_id=caller["tenant_id"],
                user_id=caller["user_id"],
                app_id=caller["app_id"],
                user_from=caller["user_from"],
                invoke_from=caller["invoke_from"],
                dataset_ids=knowledge_set.dataset_ids,
                query=query,
                retrieval=knowledge_set.retrieval,
                metadata_filtering=knowledge_set.metadata_filtering,
            )
        except DifyKnowledgeBaseClientError as exc:
            if exc.retryable and retryable_observation:
                logger.warning(
                    "knowledge base search temporarily unavailable",
                    extra={
                        "tenant_id": caller["tenant_id"],
                        "app_id": caller["app_id"],
                        "invoke_from": caller["invoke_from"],
                        "knowledge_set_id": knowledge_set.id,
                        "error_code": exc.error_code,
                        "status_code": exc.status_code,
                        "error_message": str(exc),
                    },
                    exc_info=True,
                )
                return TEMPORARY_UNAVAILABLE_OBSERVATION
            logger.error(
                "knowledge base search failed",
                extra={
                    "tenant_id": caller["tenant_id"],
                    "app_id": caller["app_id"],
                    "invoke_from": caller["invoke_from"],
                    "knowledge_set_id": knowledge_set.id,
                    "error_code": exc.error_code,
                    "status_code": exc.status_code,
                    "error_message": str(exc),
                },
                exc_info=True,
            )
            raise
        return _format_observation(response, self.config)


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


def _tool_schema(generated_sets: list[DifyKnowledgeSetConfig]) -> dict[str, object]:
    return {
        "type": "object",
        "properties": {
            "set_name": {
                "type": "string",
                "enum": [knowledge_set.name for knowledge_set in generated_sets],
                "description": "Knowledge set to search.",
            },
            "query": {
                "type": "string",
                "description": "Search query for the selected knowledge set.",
            },
        },
        "required": ["set_name", "query"],
        "additionalProperties": False,
    }


def _tool_description(generated_sets: list[DifyKnowledgeSetConfig]) -> str:
    set_descriptions = []
    for knowledge_set in generated_sets:
        if knowledge_set.description:
            set_descriptions.append(f"{knowledge_set.name}: {knowledge_set.description}")
        else:
            set_descriptions.append(knowledge_set.name)
    return f"{_KNOWLEDGE_BASE_TOOL_DESCRIPTION} Configured sets: {', '.join(set_descriptions)}."


def _eager_config_fingerprint(user_query_sets: list[DifyKnowledgeSetConfig]) -> str:
    payload = [
        {
            "id": knowledge_set.id,
            "query": knowledge_set.query.model_dump(mode="json"),
            "dataset_ids": knowledge_set.dataset_ids,
            "retrieval": knowledge_set.retrieval.model_dump(mode="json"),
            "metadata_filtering": knowledge_set.metadata_filtering.model_dump(mode="json", by_alias=True),
        }
        for knowledge_set in user_query_sets
    ]
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _format_observation(
    response: DifyKnowledgeRetrieveResponse,
    config: DifyKnowledgeBaseLayerConfig,
    *,
    include_heading: bool = True,
) -> str:
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

    lines = ["Knowledge base search results:"] if include_heading else []
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
    "Config",
    "State",
    "Capability",
    "NO_RESULTS_OBSERVATION",
    "TEMPORARY_UNAVAILABLE_OBSERVATION",
]

"""Capabilities needed by Agent Chat without owning database sessions."""

from collections.abc import Sequence
from typing import Any, Protocol

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler


class AgentDatasetTools(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        app_id: str,
        dataset_ids: list[str],
        retrieve_config: DatasetRetrieveConfigEntity | None,
        return_resource: bool,
        invoke_from: InvokeFrom,
        hit_callback: DatasetIndexToolCallbackHandler,
        user_id: str,
        inputs: dict[str, Any],
    ) -> Sequence[Tool]: ...

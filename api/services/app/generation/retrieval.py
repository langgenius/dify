"""Dataset retrieval capability required by application generation."""

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from core.app.app_config.entities import DatasetEntity
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from graphon.file import File
from services.knowledge.retrieval.adapters.resource_events import DatasetIndexToolCallbackHandler


@runtime_checkable
class ApplicationDatasetRetriever(Protocol):
    def retrieve(
        self,
        app_id: str,
        user_id: str,
        tenant_id: str,
        model_config: ModelConfigWithCredentialsEntity,
        config: DatasetEntity,
        query: str,
        invoke_from: InvokeFrom,
        show_retrieve_source: bool,
        hit_callback: DatasetIndexToolCallbackHandler,
        message_id: str,
        memory: TokenBufferMemory | None = None,
        inputs: Mapping[str, Any] | None = None,
        vision_enabled: bool = False,
    ) -> tuple[str | None, list[File] | None]: ...

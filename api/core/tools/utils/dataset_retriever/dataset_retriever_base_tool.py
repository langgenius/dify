from abc import abstractmethod
from typing import Any, Optional

from msal_extensions.persistence import ABC
from pydantic import BaseModel, ConfigDict

from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler


class DatasetRetrieverBaseTool(BaseModel, ABC):
    """Tool for querying a Dataset."""

    name: str = "dataset"
    description: str = "use this to retrieve a dataset. "
    tenant_id: str
    top_k: int = 2
    score_threshold: Optional[float] = None
    hit_callbacks: list[DatasetIndexToolCallbackHandler] = []
    return_resource: bool
    retriever_from: str
    model_config = ConfigDict(arbitrary_types_allowed=True)

    @abstractmethod
    def _run(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Use the tool.

        Add run_manager: Optional[CallbackManagerForToolRun] = None
        to child implementations to enable tracing,
        """

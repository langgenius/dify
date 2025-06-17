from collections.abc import Mapping
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class DatasourceStreamEvent(Enum):
    """
    Datasource Stream event
    """
    PROCESSING = "processing"
    COMPLETED = "completed"


class BaseDatasourceEvent(BaseModel):
    pass

class DatasourceCompletedEvent(BaseDatasourceEvent):
    event: str = DatasourceStreamEvent.COMPLETED.value
    data: Mapping[str,Any] | list = Field(..., description="result")
    total: Optional[int] = Field(..., description="total")
    completed: Optional[int] = Field(..., description="completed")
    time_consuming: Optional[float] = Field(..., description="time consuming")

class DatasourceProcessingEvent(BaseDatasourceEvent):
    event: str = DatasourceStreamEvent.PROCESSING.value
    total: Optional[int] = Field(..., description="total")
    completed: Optional[int] = Field(..., description="completed")


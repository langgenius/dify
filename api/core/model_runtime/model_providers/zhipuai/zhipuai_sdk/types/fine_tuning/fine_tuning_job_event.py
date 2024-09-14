from typing import Optional, Union

from ...core import BaseModel

__all__ = ["FineTuningJobEvent", "Metric", "JobEvent"]


class Metric(BaseModel):
    epoch: Optional[Union[str, int, float]] = None
    current_steps: Optional[int] = None
    total_steps: Optional[int] = None
    elapsed_time: Optional[str] = None
    remaining_time: Optional[str] = None
    trained_tokens: Optional[int] = None
    loss: Optional[Union[str, int, float]] = None
    eval_loss: Optional[Union[str, int, float]] = None
    acc: Optional[Union[str, int, float]] = None
    eval_acc: Optional[Union[str, int, float]] = None
    learning_rate: Optional[Union[str, int, float]] = None


class JobEvent(BaseModel):
    object: Optional[str] = None
    id: Optional[str] = None
    type: Optional[str] = None
    created_at: Optional[int] = None
    level: Optional[str] = None
    message: Optional[str] = None
    data: Optional[Metric] = None


class FineTuningJobEvent(BaseModel):
    object: Optional[str] = None
    data: list[JobEvent]
    has_more: Optional[bool] = None

from typing import Optional, Union

from pydantic import BaseModel

__all__ = ["FineTuningJob", "Error", "Hyperparameters", "ListOfFineTuningJob" ]


class Error(BaseModel):
    code: str
    message: str
    param: Optional[str] = None


class Hyperparameters(BaseModel):
    n_epochs: Union[str, int, None] = None


class FineTuningJob(BaseModel):
    id: Optional[str] = None

    request_id: Optional[str] = None

    created_at: Optional[int] = None

    error: Optional[Error] = None

    fine_tuned_model: Optional[str] = None

    finished_at: Optional[int] = None

    hyperparameters: Optional[Hyperparameters] = None

    model: Optional[str] = None

    object: Optional[str] = None

    result_files: list[str]

    status: str

    trained_tokens: Optional[int] = None

    training_file: str

    validation_file: Optional[str] = None


class ListOfFineTuningJob(BaseModel):
    object: Optional[str] = None
    data: list[FineTuningJob]
    has_more: Optional[bool] = None

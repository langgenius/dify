from __future__ import annotations
from dify_oapi.core.model.base_response import BaseResponse
# Important: Import the definition of Dataset type and its attribute types
from .dataset import *  # noqa F403
from .dataset import Dataset


class ListDatasetResponse(BaseResponse):
    data: list[Dataset] | None = None
    has_more: bool | None = None
    limit: int | None = None
    total: int | None = None
    page: int | None = None

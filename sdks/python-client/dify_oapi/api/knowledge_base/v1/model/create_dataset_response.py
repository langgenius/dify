from __future__ import annotations


from dify_oapi.core.model.base_response import BaseResponse
from .dataset import *  # noqa F403


class CreateDatasetResponse(BaseResponse, Dataset):  # noqa F405
    ...

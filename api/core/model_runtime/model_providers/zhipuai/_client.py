"""Wrapper around ZhipuAI APIs."""
from __future__ import annotations

import logging
import posixpath

from pydantic import Extra, BaseModel

from zhipuai.model_api.api import InvokeType
from zhipuai.utils import jwt_token
from zhipuai.utils.http_client import post, stream
from zhipuai.utils.sse_client import SSEClient

logger = logging.getLogger(__name__)


class ZhipuModelAPI(BaseModel):
    base_url: str = "https://open.bigmodel.cn/api/paas/v3/model-api"
    api_key: str
    api_timeout_seconds = 60

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    def invoke(self, **kwargs):
        url = self._build_api_url(kwargs, InvokeType.SYNC)
        response = post(url, self._generate_token(), kwargs, self.api_timeout_seconds)
        if not response['success']:
            raise ValueError(
                f"Error Code: {response['code']}, Message: {response['msg']} "
            )
        return response

    def sse_invoke(self, **kwargs):
        url = self._build_api_url(kwargs, InvokeType.SSE)
        data = stream(url, self._generate_token(), kwargs, self.api_timeout_seconds)
        return SSEClient(data)

    def _build_api_url(self, kwargs, *path):
        if kwargs:
            if "model" not in kwargs:
                raise Exception("model param missed")
            model = kwargs.pop("model")
        else:
            model = "-"

        return posixpath.join(self.base_url, model, *path)

    def _generate_token(self):
        if not self.api_key:
            raise Exception(
                "api_key not provided, you could provide it."
            )

        try:
            return jwt_token.generate_token(self.api_key)
        except Exception:
            raise ValueError(
                f"Your api_key is invalid, please check it."
            )

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Union

import httpx
from httpx import Timeout
from typing_extensions import override

from . import api_resource
from .core import _jwt_token
from .core._base_type import NOT_GIVEN, NotGiven
from .core._errors import ZhipuAIError
from .core._http_client import ZHIPUAI_DEFAULT_MAX_RETRIES, HttpClient


class ZhipuAI(HttpClient):
    chat: api_resource.chat
    api_key: str

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | httpx.URL | None = None,
        timeout: Union[float, Timeout, None, NotGiven] = NOT_GIVEN,
        max_retries: int = ZHIPUAI_DEFAULT_MAX_RETRIES,
        http_client: httpx.Client | None = None,
        custom_headers: Mapping[str, str] | None = None,
    ) -> None:
        if api_key is None:
            raise ZhipuAIError("No api_key provided, please provide it through parameters or environment variables")
        self.api_key = api_key

        if base_url is None:
            base_url = os.environ.get("ZHIPUAI_BASE_URL")
        if base_url is None:
            base_url = "https://open.bigmodel.cn/api/paas/v4"
        from .__version__ import __version__

        super().__init__(
            version=__version__,
            base_url=base_url,
            timeout=timeout,
            custom_httpx_client=http_client,
            custom_headers=custom_headers,
        )
        self.chat = api_resource.chat.Chat(self)
        self.images = api_resource.images.Images(self)
        self.embeddings = api_resource.embeddings.Embeddings(self)
        self.files = api_resource.files.Files(self)
        self.fine_tuning = api_resource.fine_tuning.FineTuning(self)

    @property
    @override
    def _auth_headers(self) -> dict[str, str]:
        api_key = self.api_key
        return {"Authorization": f"{_jwt_token.generate_token(api_key)}"}

    def __del__(self) -> None:
        if not hasattr(self, "_has_custom_http_client") or not hasattr(self, "close") or not hasattr(self, "_client"):
            # if the '__init__' method raised an error, self would not have client attr
            return

        if self._has_custom_http_client:
            return

        self.close()

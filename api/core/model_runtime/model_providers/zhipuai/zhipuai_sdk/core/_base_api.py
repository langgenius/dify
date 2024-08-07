from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .._client import ZhipuAI


class BaseAPI:
    _client: ZhipuAI

    def __init__(self, client: ZhipuAI) -> None:
        self._client = client
        self._delete = client.delete
        self._get = client.get
        self._post = client.post
        self._put = client.put
        self._patch = client.patch

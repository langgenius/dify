from __future__ import annotations

from typing import TYPE_CHECKING, Optional, Union

import httpx

from ..core import NOT_GIVEN, BaseAPI, Body, Headers, NotGiven, make_request_options
from ..types.embeddings import EmbeddingsResponded

if TYPE_CHECKING:
    from .._client import ZhipuAI


class Embeddings(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
        self,
        *,
        input: Union[str, list[str], list[int], list[list[int]]],
        model: Union[str],
        dimensions: Union[int] | NotGiven = NOT_GIVEN,
        encoding_format: str | NotGiven = NOT_GIVEN,
        user: str | NotGiven = NOT_GIVEN,
        request_id: Optional[str] | NotGiven = NOT_GIVEN,
        sensitive_word_check: Optional[object] | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        disable_strict_validation: Optional[bool] | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> EmbeddingsResponded:
        _cast_type = EmbeddingsResponded
        if disable_strict_validation:
            _cast_type = object
        return self._post(
            "/embeddings",
            body={
                "input": input,
                "model": model,
                "dimensions": dimensions,
                "encoding_format": encoding_format,
                "user": user,
                "request_id": request_id,
                "sensitive_word_check": sensitive_word_check,
            },
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=_cast_type,
            stream=False,
        )

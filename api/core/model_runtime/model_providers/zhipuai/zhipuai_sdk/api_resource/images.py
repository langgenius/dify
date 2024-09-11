from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import httpx

from ..core._base_api import BaseAPI
from ..core._base_type import NOT_GIVEN, Body, Headers, NotGiven
from ..core._http_client import make_user_request_input
from ..types.image import ImagesResponded

if TYPE_CHECKING:
    from .._client import ZhipuAI


class Images(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def generations(
        self,
        *,
        prompt: str,
        model: str | NotGiven = NOT_GIVEN,
        n: Optional[int] | NotGiven = NOT_GIVEN,
        quality: Optional[str] | NotGiven = NOT_GIVEN,
        response_format: Optional[str] | NotGiven = NOT_GIVEN,
        size: Optional[str] | NotGiven = NOT_GIVEN,
        style: Optional[str] | NotGiven = NOT_GIVEN,
        user: str | NotGiven = NOT_GIVEN,
        request_id: Optional[str] | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        disable_strict_validation: Optional[bool] | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ImagesResponded:
        _cast_type = ImagesResponded
        if disable_strict_validation:
            _cast_type = object
        return self._post(
            "/images/generations",
            body={
                "prompt": prompt,
                "model": model,
                "n": n,
                "quality": quality,
                "response_format": response_format,
                "size": size,
                "style": style,
                "user": user,
                "request_id": request_id,
            },
            options=make_user_request_input(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=_cast_type,
            enable_stream=False,
        )

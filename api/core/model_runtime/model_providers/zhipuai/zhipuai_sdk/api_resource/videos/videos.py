from __future__ import annotations


from typing import TYPE_CHECKING, List, Mapping, cast, Optional, Dict
from typing_extensions import Literal

from ...types.sensitive_word_check import SensitiveWordCheckRequest
from ...types.video import video_create_params
from ...types.video import VideoObject
from ...core import BaseAPI, maybe_transform
from ...core import NOT_GIVEN, Body, Headers, NotGiven

import httpx

from ...core import (
    make_request_options,
)
from ...core import deepcopy_minimal, extract_files

if TYPE_CHECKING:
    from ..._client import ZhipuAI

__all__ = ["Videos"]


class Videos(BaseAPI):

    def __init__(self, client: "ZhipuAI") -> None:
        super().__init__(client)

    def generations(
            self,
            model: str,
            *,
            prompt: str = None,
            image_url: str = None,
            sensitive_word_check: Optional[SensitiveWordCheckRequest] | NotGiven = NOT_GIVEN,
            request_id: str = None,
            user_id: str = None,
            extra_headers: Headers | None = None,
            extra_body: Body | None = None,
            timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> VideoObject:

        if not model and not model:
            raise ValueError("At least one of `model` and `prompt` must be provided.")
        body = deepcopy_minimal(
            {
                "model": model,
                "prompt": prompt,
                "image_url": image_url,
                "sensitive_word_check": sensitive_word_check,
                "request_id": request_id,
                "user_id": user_id,
            }
        )
        return self._post(
            "/videos/generations",
            body=maybe_transform(body, video_create_params.VideoCreateParams),
            options=make_request_options(
                extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
            ),
            cast_type=VideoObject,
        )

    def retrieve_videos_result(
            self,
            id: str,
            *,
            extra_headers: Headers | None = None,
            extra_body: Body | None = None,
            timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> VideoObject:

        if not id:
            raise ValueError("At least one of `id` must be provided.")

        return self._get(
            f"/async-result/{id}",
            options=make_request_options(
                extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
            ),
            cast_type=VideoObject,
        )
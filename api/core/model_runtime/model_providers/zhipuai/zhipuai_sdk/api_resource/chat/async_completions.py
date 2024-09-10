from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Optional, Union

import httpx

from ...core._base_api import BaseAPI
from ...core._base_type import NOT_GIVEN, Headers, NotGiven
from ...core._http_client import make_user_request_input
from ...types.chat.async_chat_completion import AsyncCompletion, AsyncTaskStatus

if TYPE_CHECKING:
    from ..._client import ZhipuAI


class AsyncCompletions(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
        self,
        *,
        model: str,
        request_id: Optional[str] | NotGiven = NOT_GIVEN,
        do_sample: Optional[Literal[False]] | Literal[True] | NotGiven = NOT_GIVEN,
        temperature: Optional[float] | NotGiven = NOT_GIVEN,
        top_p: Optional[float] | NotGiven = NOT_GIVEN,
        max_tokens: int | NotGiven = NOT_GIVEN,
        seed: int | NotGiven = NOT_GIVEN,
        messages: Union[str, list[str], list[int], list[list[int]], None],
        stop: Optional[Union[str, list[str], None]] | NotGiven = NOT_GIVEN,
        sensitive_word_check: Optional[object] | NotGiven = NOT_GIVEN,
        tools: Optional[object] | NotGiven = NOT_GIVEN,
        tool_choice: str | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        disable_strict_validation: Optional[bool] | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> AsyncTaskStatus:
        _cast_type = AsyncTaskStatus

        if disable_strict_validation:
            _cast_type = object
        return self._post(
            "/async/chat/completions",
            body={
                "model": model,
                "request_id": request_id,
                "temperature": temperature,
                "top_p": top_p,
                "do_sample": do_sample,
                "max_tokens": max_tokens,
                "seed": seed,
                "messages": messages,
                "stop": stop,
                "sensitive_word_check": sensitive_word_check,
                "tools": tools,
                "tool_choice": tool_choice,
            },
            options=make_user_request_input(extra_headers=extra_headers, timeout=timeout),
            cast_type=_cast_type,
            enable_stream=False,
        )

    def retrieve_completion_result(
        self,
        id: str,
        extra_headers: Headers | None = None,
        disable_strict_validation: Optional[bool] | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Union[AsyncCompletion, AsyncTaskStatus]:
        _cast_type = Union[AsyncCompletion, AsyncTaskStatus]
        if disable_strict_validation:
            _cast_type = object
        return self._get(
            path=f"/async-result/{id}",
            cast_type=_cast_type,
            options=make_user_request_input(extra_headers=extra_headers, timeout=timeout),
        )

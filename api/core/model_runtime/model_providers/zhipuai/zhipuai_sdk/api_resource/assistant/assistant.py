from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import httpx

from ...core import (
    NOT_GIVEN,
    BaseAPI,
    Body,
    Headers,
    NotGiven,
    StreamResponse,
    deepcopy_minimal,
    make_request_options,
    maybe_transform,
)
from ...types.assistant import AssistantCompletion
from ...types.assistant.assistant_conversation_resp import ConversationUsageListResp
from ...types.assistant.assistant_support_resp import AssistantSupportResp

if TYPE_CHECKING:
    from ..._client import ZhipuAI

from ...types.assistant import assistant_conversation_params, assistant_create_params

__all__ = ["Assistant"]


class Assistant(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def conversation(
        self,
        assistant_id: str,
        model: str,
        messages: list[assistant_create_params.ConversationMessage],
        *,
        stream: bool = True,
        conversation_id: Optional[str] = None,
        attachments: Optional[list[assistant_create_params.AssistantAttachments]] = None,
        metadata: dict | None = None,
        request_id: Optional[str] = None,
        user_id: Optional[str] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> StreamResponse[AssistantCompletion]:
        body = deepcopy_minimal(
            {
                "assistant_id": assistant_id,
                "model": model,
                "messages": messages,
                "stream": stream,
                "conversation_id": conversation_id,
                "attachments": attachments,
                "metadata": metadata,
                "request_id": request_id,
                "user_id": user_id,
            }
        )
        return self._post(
            "/assistant",
            body=maybe_transform(body, assistant_create_params.AssistantParameters),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=AssistantCompletion,
            stream=stream or True,
            stream_cls=StreamResponse[AssistantCompletion],
        )

    def query_support(
        self,
        *,
        assistant_id_list: Optional[list[str]] = None,
        request_id: Optional[str] = None,
        user_id: Optional[str] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> AssistantSupportResp:
        body = deepcopy_minimal(
            {
                "assistant_id_list": assistant_id_list,
                "request_id": request_id,
                "user_id": user_id,
            }
        )
        return self._post(
            "/assistant/list",
            body=body,
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=AssistantSupportResp,
        )

    def query_conversation_usage(
        self,
        assistant_id: str,
        page: int = 1,
        page_size: int = 10,
        *,
        request_id: Optional[str] = None,
        user_id: Optional[str] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ConversationUsageListResp:
        body = deepcopy_minimal(
            {
                "assistant_id": assistant_id,
                "page": page,
                "page_size": page_size,
                "request_id": request_id,
                "user_id": user_id,
            }
        )
        return self._post(
            "/assistant/conversation/list",
            body=maybe_transform(body, assistant_conversation_params.ConversationParameters),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=ConversationUsageListResp,
        )

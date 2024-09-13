from __future__ import annotations

from typing import TYPE_CHECKING, List, Mapping, cast, Optional, Dict
from typing_extensions import Literal

from ...types.assistant import AssistantCompletion
from ...types.assistant.assistant_conversation_resp import ConversationUsageList, ConversationUsageListResp
from ...types.assistant.assistant_support_resp import AssistantSupportResp
from ...core import BaseAPI, maybe_transform, StreamResponse
from ...core import NOT_GIVEN, Body, Headers, NotGiven

import httpx

from ...core import (
    make_request_options,
)
from ...core import deepcopy_minimal, extract_files

if TYPE_CHECKING:
    from ..._client import ZhipuAI

from ...types.assistant import assistant_create_params
from ...types.assistant import assistant_conversation_params

__all__ = ["Assistant"]


class Assistant(BaseAPI):

    def __init__(self, client: "ZhipuAI") -> None:
        super().__init__(client)

    def conversation(
            self,
            assistant_id: str,
            model: str,
            messages: List[assistant_create_params.ConversationMessage],
            *,
            stream: bool = True,
            conversation_id: Optional[str] = None,
            attachments: Optional[List[assistant_create_params.AssistantAttachments]] = None,
            metadata: dict | None = None,
            request_id: str = None,
            user_id: str = None,
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
            options=make_request_options(
                extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
            ),
            cast_type=AssistantCompletion,
            stream=stream or True,
            stream_cls=StreamResponse[AssistantCompletion],
        )

    def query_support(
            self,
            *,
            assistant_id_list: List[str] = None,
            request_id: str = None,
            user_id: str = None,
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
            options=make_request_options(
                extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
            ),
            cast_type=AssistantSupportResp,
        )

    def query_conversation_usage(
            self,
            assistant_id: str,
            page: int = 1,
            page_size: int = 10,
            *,
            request_id: str = None,
            user_id: str = None,
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
            options=make_request_options(
                extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
            ),
            cast_type=ConversationUsageListResp,
        )

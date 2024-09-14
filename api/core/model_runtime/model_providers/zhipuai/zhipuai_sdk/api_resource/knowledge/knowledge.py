from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Optional

import httpx

from ...core import (
    NOT_GIVEN,
    BaseAPI,
    Body,
    Headers,
    NotGiven,
    cached_property,
    deepcopy_minimal,
    make_request_options,
    maybe_transform,
)
from ...types.knowledge import KnowledgeInfo, KnowledgeUsed, knowledge_create_params, knowledge_list_params
from ...types.knowledge.knowledge_list_resp import KnowledgePage
from .document import Document

if TYPE_CHECKING:
    from ..._client import ZhipuAI

__all__ = ["Knowledge"]


class Knowledge(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    @cached_property
    def document(self) -> Document:
        return Document(self._client)

    def create(
        self,
        embedding_id: int,
        name: str,
        *,
        customer_identifier: Optional[str] = None,
        description: Optional[str] = None,
        background: Optional[Literal["blue", "red", "orange", "purple", "sky"]] = None,
        icon: Optional[Literal["question", "book", "seal", "wrench", "tag", "horn", "house"]] = None,
        bucket_id: Optional[str] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> KnowledgeInfo:
        body = deepcopy_minimal(
            {
                "embedding_id": embedding_id,
                "name": name,
                "customer_identifier": customer_identifier,
                "description": description,
                "background": background,
                "icon": icon,
                "bucket_id": bucket_id,
            }
        )
        return self._post(
            "/knowledge",
            body=maybe_transform(body, knowledge_create_params.KnowledgeBaseParams),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=KnowledgeInfo,
        )

    def modify(
        self,
        knowledge_id: str,
        embedding_id: int,
        *,
        name: str,
        description: Optional[str] = None,
        background: Optional[Literal["blue", "red", "orange", "purple", "sky"]] = None,
        icon: Optional[Literal["question", "book", "seal", "wrench", "tag", "horn", "house"]] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> httpx.Response:
        body = deepcopy_minimal(
            {
                "id": knowledge_id,
                "embedding_id": embedding_id,
                "name": name,
                "description": description,
                "background": background,
                "icon": icon,
            }
        )
        return self._put(
            f"/knowledge/{knowledge_id}",
            body=maybe_transform(body, knowledge_create_params.KnowledgeBaseParams),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=httpx.Response,
        )

    def query(
        self,
        *,
        page: int | NotGiven = 1,
        size: int | NotGiven = 10,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> KnowledgePage:
        return self._get(
            "/knowledge",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "page": page,
                        "size": size,
                    },
                    knowledge_list_params.KnowledgeListParams,
                ),
            ),
            cast_type=KnowledgePage,
        )

    def delete(
        self,
        knowledge_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> httpx.Response:
        """
        Delete a file.

        Args:
          knowledge_id: 知识库ID
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not knowledge_id:
            raise ValueError("Expected a non-empty value for `knowledge_id`")

        return self._delete(
            f"/knowledge/{knowledge_id}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=httpx.Response,
        )

    def used(
        self,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> KnowledgeUsed:
        """
        Returns the contents of the specified file.

        Args:
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/knowledge/capacity",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=KnowledgeUsed,
        )

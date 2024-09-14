from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Literal, Optional, cast

import httpx

from ....core import (
    NOT_GIVEN,
    BaseAPI,
    Body,
    FileTypes,
    Headers,
    NotGiven,
    deepcopy_minimal,
    extract_files,
    make_request_options,
    maybe_transform,
)
from ....types.files import UploadDetail, file_create_params
from ....types.knowledge.document import DocumentData, DocumentObject, document_edit_params, document_list_params
from ....types.knowledge.document.document_list_resp import DocumentPage

if TYPE_CHECKING:
    from ...._client import ZhipuAI

__all__ = ["Document"]


class Document(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
        self,
        *,
        file: FileTypes = None,
        custom_separator: Optional[list[str]] = None,
        upload_detail: list[UploadDetail] = None,
        purpose: Literal["retrieval"],
        knowledge_id: str = None,
        sentence_size: int = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> DocumentObject:
        if not file and not upload_detail:
            raise ValueError("At least one of `file` and `upload_detail` must be provided.")
        body = deepcopy_minimal(
            {
                "file": file,
                "upload_detail": upload_detail,
                "purpose": purpose,
                "custom_separator": custom_separator,
                "knowledge_id": knowledge_id,
                "sentence_size": sentence_size,
            }
        )
        files = extract_files(cast(Mapping[str, object], body), paths=[["file"]])
        if files:
            # It should be noted that the actual Content-Type header that will be
            # sent to the server will contain a `boundary` parameter, e.g.
            # multipart/form-data; boundary=---abc--
            extra_headers = {"Content-Type": "multipart/form-data", **(extra_headers or {})}
        return self._post(
            "/files",
            body=maybe_transform(body, file_create_params.FileCreateParams),
            files=files,
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=DocumentObject,
        )

    def edit(
        self,
        document_id: str,
        knowledge_type: str,
        *,
        custom_separator: Optional[list[str]] = None,
        sentence_size: Optional[int] = None,
        callback_url: Optional[str] = None,
        callback_header: Optional[dict[str, str]] = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> httpx.Response:
        """

        Args:
          document_id: 知识id
          knowledge_type: 知识类型:
                        1:文章知识: 支持pdf,url,docx
                        2.问答知识-文档:  支持pdf,url,docx
                        3.问答知识-表格:  支持xlsx
                        4.商品库-表格:  支持xlsx
                        5.自定义:  支持pdf,url,docx
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
          :param knowledge_type:
          :param document_id:
          :param timeout:
          :param extra_body:
          :param callback_header:
          :param sentence_size:
          :param extra_headers:
          :param callback_url:
          :param custom_separator:
        """
        if not document_id:
            raise ValueError(f"Expected a non-empty value for `document_id` but received {document_id!r}")

        body = deepcopy_minimal(
            {
                "id": document_id,
                "knowledge_type": knowledge_type,
                "custom_separator": custom_separator,
                "sentence_size": sentence_size,
                "callback_url": callback_url,
                "callback_header": callback_header,
            }
        )

        return self._put(
            f"/document/{document_id}",
            body=maybe_transform(body, document_edit_params.DocumentEditParams),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=httpx.Response,
        )

    def list(
        self,
        knowledge_id: str,
        *,
        purpose: str | NotGiven = NOT_GIVEN,
        page: str | NotGiven = NOT_GIVEN,
        limit: str | NotGiven = NOT_GIVEN,
        order: Literal["desc", "asc"] | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> DocumentPage:
        return self._get(
            "/files",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "knowledge_id": knowledge_id,
                        "purpose": purpose,
                        "page": page,
                        "limit": limit,
                        "order": order,
                    },
                    document_list_params.DocumentListParams,
                ),
            ),
            cast_type=DocumentPage,
        )

    def delete(
        self,
        document_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> httpx.Response:
        """
        Delete a file.

        Args:

          document_id: 知识id
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not document_id:
            raise ValueError(f"Expected a non-empty value for `document_id` but received {document_id!r}")

        return self._delete(
            f"/document/{document_id}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=httpx.Response,
        )

    def retrieve(
        self,
        document_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> DocumentData:
        """

        Args:
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not document_id:
            raise ValueError(f"Expected a non-empty value for `document_id` but received {document_id!r}")

        return self._get(
            f"/document/{document_id}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=DocumentData,
        )

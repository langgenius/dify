from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Literal, cast

import httpx

from ..core import (
    NOT_GIVEN,
    BaseAPI,
    Body,
    FileTypes,
    Headers,
    NotGiven,
    _legacy_binary_response,
    _legacy_response,
    deepcopy_minimal,
    extract_files,
    make_request_options,
    maybe_transform,
)
from ..types.files import FileDeleted, FileObject, ListOfFileObject, UploadDetail, file_create_params

if TYPE_CHECKING:
    from .._client import ZhipuAI

__all__ = ["Files", "FilesWithRawResponse"]


class Files(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
        self,
        *,
        file: FileTypes = None,
        upload_detail: list[UploadDetail] = None,
        purpose: Literal["fine-tune", "retrieval", "batch"],
        knowledge_id: str = None,
        sentence_size: int = None,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FileObject:
        if not file and not upload_detail:
            raise ValueError("At least one of `file` and `upload_detail` must be provided.")
        body = deepcopy_minimal(
            {
                "file": file,
                "upload_detail": upload_detail,
                "purpose": purpose,
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
            cast_type=FileObject,
        )

    # def retrieve(
    #         self,
    #         file_id: str,
    #         *,
    #         extra_headers: Headers | None = None,
    #         extra_body: Body | None = None,
    #         timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    # ) -> FileObject:
    #     """
    #     Returns information about a specific file.
    #
    #     Args:
    #       file_id: The ID of the file to retrieve information about
    #       extra_headers: Send extra headers
    #
    #       extra_body: Add additional JSON properties to the request
    #
    #       timeout: Override the client-level default timeout for this request, in seconds
    #     """
    #     if not file_id:
    #         raise ValueError(f"Expected a non-empty value for `file_id` but received {file_id!r}")
    #     return self._get(
    #         f"/files/{file_id}",
    #         options=make_request_options(
    #             extra_headers=extra_headers, extra_body=extra_body, timeout=timeout
    #         ),
    #         cast_type=FileObject,
    #     )

    def list(
        self,
        *,
        purpose: str | NotGiven = NOT_GIVEN,
        limit: int | NotGiven = NOT_GIVEN,
        after: str | NotGiven = NOT_GIVEN,
        order: str | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ListOfFileObject:
        return self._get(
            "/files",
            cast_type=ListOfFileObject,
            options=make_request_options(
                extra_headers=extra_headers,
                extra_body=extra_body,
                timeout=timeout,
                query={
                    "purpose": purpose,
                    "limit": limit,
                    "after": after,
                    "order": order,
                },
            ),
        )

    def delete(
        self,
        file_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FileDeleted:
        """
        Delete a file.

        Args:
          file_id: The ID of the file to delete
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not file_id:
            raise ValueError(f"Expected a non-empty value for `file_id` but received {file_id!r}")
        return self._delete(
            f"/files/{file_id}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=FileDeleted,
        )

    def content(
        self,
        file_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> _legacy_response.HttpxBinaryResponseContent:
        """
        Returns the contents of the specified file.

        Args:
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not file_id:
            raise ValueError(f"Expected a non-empty value for `file_id` but received {file_id!r}")
        extra_headers = {"Accept": "application/binary", **(extra_headers or {})}
        return self._get(
            f"/files/{file_id}/content",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=_legacy_binary_response.HttpxBinaryResponseContent,
        )


class FilesWithRawResponse:
    def __init__(self, files: Files) -> None:
        self._files = files

        self.create = _legacy_response.to_raw_response_wrapper(
            files.create,
        )
        self.list = _legacy_response.to_raw_response_wrapper(
            files.list,
        )
        self.content = _legacy_response.to_raw_response_wrapper(
            files.content,
        )

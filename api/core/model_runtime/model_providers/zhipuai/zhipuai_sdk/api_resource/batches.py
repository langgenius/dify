from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Optional

import httpx

from ..core import NOT_GIVEN, BaseAPI, Body, Headers, NotGiven, make_request_options, maybe_transform
from ..core.pagination import SyncCursorPage
from ..types import batch_create_params, batch_list_params
from ..types.batch import Batch

if TYPE_CHECKING:
    from .._client import ZhipuAI


class Batches(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
        self,
        *,
        completion_window: str | None = None,
        endpoint: Literal["/v1/chat/completions", "/v1/embeddings"],
        input_file_id: str,
        metadata: Optional[dict[str, str]] | NotGiven = NOT_GIVEN,
        auto_delete_input_file: bool = True,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Batch:
        return self._post(
            "/batches",
            body=maybe_transform(
                {
                    "completion_window": completion_window,
                    "endpoint": endpoint,
                    "input_file_id": input_file_id,
                    "metadata": metadata,
                    "auto_delete_input_file": auto_delete_input_file,
                },
                batch_create_params.BatchCreateParams,
            ),
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=Batch,
        )

    def retrieve(
        self,
        batch_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Batch:
        """
        Retrieves a batch.

        Args:
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        if not batch_id:
            raise ValueError(f"Expected a non-empty value for `batch_id` but received {batch_id!r}")
        return self._get(
            f"/batches/{batch_id}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=Batch,
        )

    def list(
        self,
        *,
        after: str | NotGiven = NOT_GIVEN,
        limit: int | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> SyncCursorPage[Batch]:
        """List your organization's batches.

        Args:
          after: A cursor for use in pagination.

            `after` is an object ID that defines your place
              in the list. For instance, if you make a list request and receive 100 objects,
              ending with obj_foo, your subsequent call can include after=obj_foo in order to
              fetch the next page of the list.

          limit: A limit on the number of objects to be returned. Limit can range between 1 and
              100, and the default is 20.

          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get_api_list(
            "/batches",
            page=SyncCursorPage[Batch],
            options=make_request_options(
                extra_headers=extra_headers,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "after": after,
                        "limit": limit,
                    },
                    batch_list_params.BatchListParams,
                ),
            ),
            model=Batch,
        )

    def cancel(
        self,
        batch_id: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> Batch:
        """
        Cancels an in-progress batch.

        Args:
          batch_id: The ID of the batch to cancel.
          extra_headers: Send extra headers

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds

        """
        if not batch_id:
            raise ValueError(f"Expected a non-empty value for `batch_id` but received {batch_id!r}")
        return self._post(
            f"/batches/{batch_id}/cancel",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=Batch,
        )

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import httpx

from ...core._base_api import BaseAPI
from ...core._base_type import NOT_GIVEN, Headers, NotGiven
from ...core._http_client import make_user_request_input
from ...types.fine_tuning import FineTuningJob, FineTuningJobEvent, ListOfFineTuningJob, job_create_params

if TYPE_CHECKING:
    from ..._client import ZhipuAI

__all__ = ["Jobs"]


class Jobs(BaseAPI):

    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def create(
            self,
            *,
            model: str,
            training_file: str,
            hyperparameters: job_create_params.Hyperparameters | NotGiven = NOT_GIVEN,
            suffix: Optional[str] | NotGiven = NOT_GIVEN,
            request_id: Optional[str] | NotGiven = NOT_GIVEN,
            validation_file: Optional[str] | NotGiven = NOT_GIVEN,
            extra_headers: Headers | None = None,
            timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FineTuningJob:
        return self._post(
            "/fine_tuning/jobs",
            body={
                "model": model,
                "training_file": training_file,
                "hyperparameters": hyperparameters,
                "suffix": suffix,
                "validation_file": validation_file,
                "request_id": request_id,
            },
            options=make_user_request_input(
                extra_headers=extra_headers, timeout=timeout
            ),
            cast_type=FineTuningJob,
        )

    def retrieve(
            self,
            fine_tuning_job_id: str,
            *,
            extra_headers: Headers | None = None,
            timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FineTuningJob:
        return self._get(
            f"/fine_tuning/jobs/{fine_tuning_job_id}",
            options=make_user_request_input(
                extra_headers=extra_headers, timeout=timeout
            ),
            cast_type=FineTuningJob,
        )

    def list(
            self,
            *,
            after: str | NotGiven = NOT_GIVEN,
            limit: int | NotGiven = NOT_GIVEN,
            extra_headers: Headers | None = None,
            timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> ListOfFineTuningJob:
        return self._get(
            "/fine_tuning/jobs",
            cast_type=ListOfFineTuningJob,
            options=make_user_request_input(
                extra_headers=extra_headers,
                timeout=timeout,
                query={
                    "after": after,
                    "limit": limit,
                },
            ),
        )

    def list_events(
        self,
        fine_tuning_job_id: str,
        *,
        after: str | NotGiven = NOT_GIVEN,
        limit: int | NotGiven = NOT_GIVEN,
        extra_headers: Headers | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FineTuningJobEvent:

        return self._get(
            f"/fine_tuning/jobs/{fine_tuning_job_id}/events",
            cast_type=FineTuningJobEvent,
            options=make_user_request_input(
                extra_headers=extra_headers,
                timeout=timeout,
                query={
                    "after": after,
                    "limit": limit,
                },
            ),
        )

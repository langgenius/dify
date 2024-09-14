from __future__ import annotations

from typing import TYPE_CHECKING

import httpx

from ....core import (
    NOT_GIVEN,
    BaseAPI,
    Body,
    Headers,
    NotGiven,
    make_request_options,
)
from ....types.fine_tuning.models import FineTunedModelsStatus

if TYPE_CHECKING:
    from ...._client import ZhipuAI

__all__ = ["FineTunedModels"]


class FineTunedModels(BaseAPI):
    def __init__(self, client: ZhipuAI) -> None:
        super().__init__(client)

    def delete(
        self,
        fine_tuned_model: str,
        *,
        extra_headers: Headers | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
    ) -> FineTunedModelsStatus:
        if not fine_tuned_model:
            raise ValueError(f"Expected a non-empty value for `fine_tuned_model` but received {fine_tuned_model!r}")
        return self._delete(
            f"fine_tuning/fine_tuned_models/{fine_tuned_model}",
            options=make_request_options(extra_headers=extra_headers, extra_body=extra_body, timeout=timeout),
            cast_type=FineTunedModelsStatus,
        )

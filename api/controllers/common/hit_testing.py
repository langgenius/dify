"""Shared request validation for the legacy knowledge retrieval HTTP routes."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request
from pydantic import ValidationError

from controllers.common.errors import InvalidArgumentError
from fields.hit_testing_fields import HitTestingPayload


def validate_hit_testing_payload[T, **P, R](
    view: Callable[Concatenate[T, HitTestingPayload, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Validate admitted retrieval requests and retain their HTTP 400 error contract.

    Successful calls receive a payload with normalized upload UUIDs. Invalid
    input raises invalid_param before the retrieval use case can run.
    """

    @wraps(view)
    def validated(self: T, *args: P.args, **kwargs: P.kwargs) -> R:
        try:
            payload = HitTestingPayload.model_validate(request.get_json(silent=True) or {})
        except ValidationError as error:
            raise InvalidArgumentError(description=str(error)) from error
        return view(self, payload, *args, **kwargs)

    return validated

"""The openapi run boundary maps internal rate-limit exceptions to canonical 429s.

Both render through the ErrorBody formatter: TooManyRequests -> code "too_many_requests"
(retryable throttle), InvokeRateLimitError -> code "rate_limit_error" (quota).
"""

import pytest
from werkzeug.exceptions import TooManyRequests

from controllers.openapi.app_run import _translate_service_errors
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.errors.error import AppInvokeQuotaExceededError
from services.errors.llm import InvokeRateLimitError


def test_translate_maps_app_concurrency_to_too_many_requests():
    # Regression guard: this used to fall through to a 500 (it was not caught here).
    with pytest.raises(TooManyRequests) as exc:
        with _translate_service_errors():
            raise AppInvokeQuotaExceededError("internal: client_id=abc max=10")
    assert exc.value.code == 429


def test_translate_maps_workflow_quota_to_rate_limit_error():
    with pytest.raises(InvokeRateLimitHttpError) as exc:
        with _translate_service_errors():
            raise InvokeRateLimitError("workflow quota exhausted")
    assert exc.value.error_code == "rate_limit_error"
    assert exc.value.code == 429

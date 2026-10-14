import pytest
from pydantic import BaseModel

from libs.exception import BaseHTTPException


class _QuotaDetails(BaseModel):
    limit: int


class _OtherDetails(BaseModel):
    limit: int


class _QuotaExceededError(BaseHTTPException):
    error_code = "quota_exceeded"
    description = "Exceeded the limit of {limit} items."
    code = 400
    details_model = _QuotaDetails


class _PlainError(BaseHTTPException):
    error_code = "plain"
    description = "Something {braced} stays literal."
    code = 400


def test_templated_error_renders_its_message_from_details() -> None:
    error = _QuotaExceededError(details=_QuotaDetails(limit=3))

    assert error.data == {
        "code": "quota_exceeded",
        "message": "Exceeded the limit of 3 items.",
        "status": 400,
        "details": {"limit": 3},
    }


def test_templated_error_rejects_a_message_override() -> None:
    with pytest.raises(TypeError, match="renders its message from details"):
        _QuotaExceededError("Exceeded 3", details=_QuotaDetails(limit=3))


@pytest.mark.parametrize("details", [None, _OtherDetails(limit=3)])
def test_templated_error_requires_its_own_details_model(details: BaseModel | None) -> None:
    with pytest.raises(TypeError, match="requires details of type _QuotaDetails"):
        _QuotaExceededError(details=details)


def test_error_without_details_model_keeps_its_description_and_rejects_details() -> None:
    assert _PlainError().data == {"code": "plain", "message": "Something {braced} stays literal.", "status": 400}
    assert _PlainError("Overridden.").data == {"code": "plain", "message": "Overridden.", "status": 400}
    with pytest.raises(TypeError, match="declares no details_model"):
        _PlainError(details=_QuotaDetails(limit=1))

from collections.abc import Callable

from werkzeug.exceptions import HTTPException


def raised_error(call: Callable[[], object]) -> tuple[dict[str, object], int]:
    """Run a handler call that must fail and return its error ``(body, status)``.

    Controllers raise ``BaseHTTPException`` subclasses whose body carries the standard
    ``status`` field. It is checked against the HTTP status here and left out of the
    returned body, so assertions compare only the fields that vary per error.
    """
    try:
        call()
    except HTTPException as error:
        body = getattr(error, "data", None)
        if not isinstance(body, dict):
            raise AssertionError(f"{error!r} carries no error body") from error
        status = error.code
        assert status is not None
        assert body.get("status") == status, f"body status {body.get('status')!r} != HTTP status {status}"
        return {key: value for key, value in body.items() if key != "status"}, status
    raise AssertionError("expected the handler to raise an HTTP error")

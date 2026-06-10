"""Wire-contract tests for the canonical /openapi/v1 error body."""

import pytest
from werkzeug.exceptions import Conflict, NotFound, UnprocessableEntity

from controllers.openapi._errors import ErrorBody, ErrorDetail, OpenApiError, OpenApiErrorCode, OpenApiErrorFormatter
from controllers.web.error import ProviderQuotaExceededError


class TestErrorBodyModel:
    def test_minimal_body_serializes_without_optional_fields(self):
        body = ErrorBody(code=OpenApiErrorCode.NOT_FOUND, message="app not found", status=404)

        wire = body.model_dump(mode="json", exclude_none=True)

        assert wire == {"code": "not_found", "message": "app not found", "status": 404}

    def test_full_body_round_trips(self):
        body = ErrorBody(
            code=OpenApiErrorCode.INVALID_PARAM,
            message="Request validation failed",
            status=422,
            hint="check the request payload",
            details=[ErrorDetail(type="int_parsing", loc=["page"], msg="must be >= 1")],
        )

        wire = body.model_dump(mode="json", exclude_none=True)

        assert wire["details"] == [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}]
        assert ErrorBody.model_validate(wire) == body

    def test_code_field_is_open_string_for_forward_compat(self):
        # Old CLIs must not hard-fail when a future server adds a code, so the
        # schema type is str; enum membership is enforced by the formatter tests.
        body = ErrorBody.model_validate({"code": "some_future_code", "message": "x", "status": 400})

        assert body.code == "some_future_code"


class TestOpenApiErrorFormatter:
    @pytest.fixture
    def fmt(self):
        return OpenApiErrorFormatter()

    def test_plain_werkzeug_exception_maps_code_from_status(self, fmt):
        e = NotFound("app not found")
        data = {"code": "not_found", "message": "app not found", "status": 404}

        wire = fmt.finalize(e, data, 404)

        assert wire == {"code": "not_found", "message": "app not found", "status": 404}

    def test_422_maps_to_invalid_param(self, fmt):
        e = UnprocessableEntity("workspace_id is required for name-based lookup")
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        wire = fmt.finalize(e, data, 422)

        assert wire["code"] == "invalid_param"

    def test_flask_restx_abort_data_path_yields_canonical_body(self, fmt):
        # Simulates _contract.py's abort(422, message=..., errors=...): flask_restx
        # attaches kwargs to e.data, which handle_error would otherwise put on the
        # wire verbatim (no code/status).
        e = UnprocessableEntity()
        e.data = {
            "message": "Request validation failed",
            "errors": [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1", "extra": "drop me"}],
        }
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        wire = fmt.finalize(e, data, 422)

        assert wire["code"] == "invalid_param"
        assert wire["message"] == "Request validation failed"
        assert wire["status"] == 422
        assert wire["details"] == [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}]
        # the override channel now carries the canonical body
        assert e.data == wire

    def test_finalize_is_idempotent(self, fmt):
        e = UnprocessableEntity()
        e.data = {
            "message": "Request validation failed",
            "errors": [{"type": "int_parsing", "loc": ["page"], "msg": "must be >= 1"}],
        }
        data = {"code": "unprocessable_entity", "message": e.description, "status": 422}

        first = fmt.finalize(e, data, 422)
        second = fmt.finalize(e, data, 422)

        assert second == first

    def test_base_http_exception_error_code_wins_over_status_map(self, fmt):
        e = ProviderQuotaExceededError()
        data = dict(e.data)

        wire = fmt.finalize(e, data, 400)

        assert wire["code"] == "provider_quota_exceeded"
        assert wire["status"] == 400

    def test_hint_attribute_is_emitted(self, fmt):
        e = Conflict("seat limit")
        e.hint = "remove a member first"
        data = {"code": "conflict", "message": "seat limit", "status": 409}

        wire = fmt.finalize(e, data, 409)

        assert wire["hint"] == "remove a member first"

    def test_params_shape_becomes_details(self, fmt):
        e = ValueError("is required")
        data = {"code": "invalid_param", "message": "is required", "params": "email", "status": 400}

        wire = fmt.finalize(e, data, 400)

        assert "params" not in wire
        assert wire["details"] == [{"type": "invalid", "loc": ["email"], "msg": "is required"}]

    def test_catch_all_exception_never_leaks_str_e(self, fmt):
        e = RuntimeError("postgres password=hunter2 connection refused")
        data = {"message": str(e), "code": "unknown", "status": 500}

        wire = fmt.finalize(e, data, 500)

        assert wire["code"] == "internal_server_error"
        assert "hunter2" not in wire["message"]

    def test_unmapped_status_falls_back_to_unknown(self, fmt):
        from werkzeug.exceptions import Gone

        e = Gone()
        data = {"code": "gone", "message": e.description, "status": 410}

        wire = fmt.finalize(e, data, 410)

        assert wire["code"] == "unknown"

    def test_openapi_error_subclass_is_throw_and_done(self, fmt):
        # The dedicated throwable: subclass declares status + code + message once,
        # call sites just `raise`; the formatter emits everything verbatim.
        class TeapotError(OpenApiError):
            code = 418
            error_code = OpenApiErrorCode.INVALID_PARAM
            description = "kettle says no"

        e = TeapotError(details=[ErrorDetail(type="invalid", loc=["kettle"], msg="too hot")])
        data = {"code": "im_a_teapot", "message": e.description, "status": 418}

        wire = fmt.finalize(e, data, 418)

        assert wire["code"] == OpenApiErrorCode.INVALID_PARAM
        assert wire["message"] == TeapotError.description
        assert wire["details"] == [{"type": "invalid", "loc": ["kettle"], "msg": "too hot"}]

    def test_openapi_error_message_override(self, fmt):
        e = OpenApiError("custom reason")
        data = {"code": "bad_request", "message": e.description, "status": 400}

        wire = fmt.finalize(e, data, 400)

        assert wire["message"] == "custom reason"
        assert wire["code"] == "bad_request"

    def test_every_emitted_code_is_an_enum_member(self, fmt):
        # Guard against the formatter inventing codes outside the contract.
        cases = [
            (NotFound("x"), {"code": "not_found", "message": "x", "status": 404}, 404),
            (ProviderQuotaExceededError(), dict(ProviderQuotaExceededError().data), 400),
            (ValueError("x"), {"code": "invalid_param", "message": "x", "status": 400}, 400),
        ]
        for e, data, status in cases:
            wire = fmt.finalize(e, data, status)
            assert wire["code"] in {c.value for c in OpenApiErrorCode}

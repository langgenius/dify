"""Wire-contract tests for the canonical /openapi/v1 error body."""

from controllers.openapi._errors import ErrorBody, ErrorDetail, OpenApiErrorCode


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

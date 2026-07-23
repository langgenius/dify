import pytest
from flask import Response, stream_with_context

from app_factory import create_flask_app_with_configs
from core.logging.context import get_identity_context, set_identity_context


def test_request_teardown_clears_logging_identity() -> None:
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True

    @app.get("/logging-context")
    def set_identity() -> str:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="end_user")
        return "ok"

    response = app.test_client().get("/logging-context", buffered=False)

    assert response.status_code == 200
    assert get_identity_context() == ("tenant-id", "user-id", "end_user")

    response.close()

    assert get_identity_context() == ("", "", "")


def test_logging_identity_remains_available_while_streaming() -> None:
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True
    identities: list[tuple[str, str, str]] = []

    @app.get("/logging-context-stream")
    def stream_with_identity() -> Response:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="end_user")

        def generate():
            identities.append(get_identity_context())
            yield "event\n"

        return Response(generate())

    response = app.test_client().get("/logging-context-stream", buffered=False)

    assert response.get_data(as_text=True) == "event\n"
    assert identities == [("tenant-id", "user-id", "end_user")]

    response.close()

    assert get_identity_context() == ("", "", "")


def test_logging_identity_remains_available_when_streaming_fails() -> None:
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True

    @app.get("/logging-context-stream-error")
    def stream_with_identity_then_fail() -> Response:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="end_user")

        @stream_with_context
        def generate():
            yield "event\n"
            raise RuntimeError("stream failed")

        return Response(generate())

    response = app.test_client().get("/logging-context-stream-error", buffered=False)
    chunks = iter(response.response)

    assert next(chunks) == b"event\n"
    with pytest.raises(RuntimeError, match="stream failed"):
        next(chunks)
    assert get_identity_context() == ("tenant-id", "user-id", "end_user")

    response.close()

    assert get_identity_context() == ("", "", "")


def test_direct_passthrough_response_clears_identity_during_teardown() -> None:
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True

    @app.get("/logging-context-file")
    def direct_passthrough_response() -> Response:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="end_user")
        return Response([b"file"], direct_passthrough=True)

    response = app.test_client().get("/logging-context-file", buffered=False)

    assert response.get_data() == b"file"
    assert get_identity_context() == ("", "", "")


def test_request_teardown_clears_logging_identity_after_exception() -> None:
    app = create_flask_app_with_configs()
    app.config["TESTING"] = True

    @app.get("/logging-context-error")
    def set_identity_then_fail() -> str:
        set_identity_context(tenant_id="tenant-id", user_id="user-id", user_type="end_user")
        raise RuntimeError("failed")

    with pytest.raises(RuntimeError, match="failed"):
        app.test_client().get("/logging-context-error")

    assert get_identity_context() == ("", "", "")

import httpx
import pytest
from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl import base as base_mod
from core.plugin.impl.first_token_timeout import FirstTokenTimeoutError, first_token_timeout_ctx

BasePluginClient = base_mod.BasePluginClient


@pytest.fixture(autouse=True)
def _isolate_ctx():
    """Keep the first-token-timeout ContextVar from leaking between tests."""
    token = first_token_timeout_ctx.set(None)
    try:
        yield
    finally:
        first_token_timeout_ctx.reset(token)


class _PlainStream:
    """Fully buffered fake httpx stream context."""

    def __init__(self, lines: list[object]) -> None:
        self._lines = lines

    def __enter__(self) -> "_PlainStream":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def iter_lines(self):
        return iter(self._lines)


class _RaiseOnEnterStream:
    """Fake stream whose context entry raises — models a timeout while awaiting headers."""

    def __init__(self, exc: BaseException) -> None:
        self._exc = exc

    def __enter__(self) -> "_RaiseOnEnterStream":
        raise self._exc

    def __exit__(self, *exc: object) -> bool:
        return False


class _LinesThenRaiseStream:
    """Yields some lines, then raises — models a stall after the first token(s)."""

    def __init__(self, lines: list[object], exc: BaseException) -> None:
        self._lines = lines
        self._exc = exc

    def __enter__(self) -> "_LinesThenRaiseStream":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def iter_lines(self):
        yield from self._lines
        raise self._exc


# --- _read_timeout_for ------------------------------------------------------------------


def test_read_timeout_for_narrows_read_only() -> None:
    base = base_mod.plugin_daemon_request_timeout
    timeout = base_mod._read_timeout_for(5.0)

    assert timeout is not base
    assert timeout.read == 5.0
    # The other components are preserved from the default timeout.
    assert timeout.connect == base.connect
    assert timeout.write == base.write
    assert timeout.pool == base.pool


@pytest.mark.parametrize("disabled", [None, 0.0, -1.0])
def test_read_timeout_for_disabled_returns_base_unchanged(disabled: float | None) -> None:
    assert base_mod._read_timeout_for(disabled) is base_mod.plugin_daemon_request_timeout


def test_read_timeout_for_with_no_base_timeout(mocker: MockerFixture) -> None:
    mocker.patch("core.plugin.impl.base.plugin_daemon_request_timeout", None)

    timeout = base_mod._read_timeout_for(5.0)

    assert timeout.read == 5.0
    assert timeout.connect is None
    assert timeout.write is None
    assert timeout.pool is None


# --- _stream_request timeout wiring ------------------------------------------------------


def test_stream_request_narrows_read_when_gate_enabled(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    stream = mocker.patch("httpx.Client.stream", return_value=_PlainStream([b"data: hi"]))
    first_token_timeout_ctx.set(1.5)

    result = list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

    assert result == ["hi"]
    assert stream.call_args.kwargs["timeout"].read == 1.5


@pytest.mark.parametrize("disabled", [None, 0.0])
def test_stream_request_keeps_default_timeout_when_gate_disabled(mocker: MockerFixture, disabled: float | None) -> None:
    client = BasePluginClient()
    stream = mocker.patch("httpx.Client.stream", return_value=_PlainStream([b"data: hi"]))
    first_token_timeout_ctx.set(disabled)

    list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

    assert stream.call_args.kwargs["timeout"] is base_mod.plugin_daemon_request_timeout


def test_stream_request_forwards_all_lines(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch("httpx.Client.stream", return_value=_PlainStream([b"", b"data: hello", "world"]))
    first_token_timeout_ctx.set(1.0)

    result = list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))

    assert result == ["hello", "world"]


# --- _stream_request timeout semantics ---------------------------------------------------


def test_read_timeout_before_first_line_raises_first_token_timeout(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch("httpx.Client.stream", return_value=_RaiseOnEnterStream(httpx.ReadTimeout("headers")))
    first_token_timeout_ctx.set(0.5)

    with pytest.raises(FirstTokenTimeoutError):
        list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))


def test_read_timeout_with_gate_disabled_is_transport_error(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch("httpx.Client.stream", return_value=_RaiseOnEnterStream(httpx.ReadTimeout("headers")))
    # ctx is None (autouse fixture) -> gate off -> a read timeout is just a transport error.

    with pytest.raises(PluginDaemonInnerError):
        list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))


def test_read_timeout_after_first_line_is_transport_error(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch(
        "httpx.Client.stream",
        return_value=_LinesThenRaiseStream([b"data: hello"], httpx.ReadTimeout("inter-token")),
    )
    first_token_timeout_ctx.set(0.5)

    # First token already seen -> a later read timeout is an inter-token stall, not a
    # first-token timeout. With the gate on, the message names the configured window so
    # the stall is traceable to the user's setting.
    with pytest.raises(PluginDaemonInnerError) as exc_info:
        list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))
    assert "0.5s first-token timeout window" in exc_info.value.message


def test_read_timeout_after_first_line_with_gate_off_keeps_plain_message(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch(
        "httpx.Client.stream",
        return_value=_LinesThenRaiseStream([b"data: hello"], httpx.ReadTimeout("inter-token")),
    )
    # ctx is None (autouse fixture) -> gate off -> no window hint in the message.

    with pytest.raises(PluginDaemonInnerError) as exc_info:
        list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))
    assert "first-token timeout window" not in exc_info.value.message


def test_non_timeout_request_error_is_transport_error(mocker: MockerFixture) -> None:
    client = BasePluginClient()
    mocker.patch("httpx.Client.stream", return_value=_RaiseOnEnterStream(httpx.ConnectError("boom")))
    first_token_timeout_ctx.set(0.5)

    # Only a ReadTimeout maps to FirstTokenTimeoutError; other transport errors do not.
    with pytest.raises(PluginDaemonInnerError):
        list(client._stream_request("POST", "plugin/tenant/stream", data={"k": "v"}))


# --- graphon error-transform contract -----------------------------------------------------


def test_first_token_timeout_error_survives_graphon_invoke_error_transform() -> None:
    """Pin the graphon behavior the error_type contract depends on.

    Workflow observability surfaces error_type == "FirstTokenTimeoutError" only because
    graphon's ``AIModel._transform_invoke_error`` returns the original exception unchanged:
    ``InvokeError`` subclasses ``ValueError`` and the default mapping carries a
    ``ValueError -> [ValueError]`` passthrough entry. If a graphon bump changes either
    fact, the error type silently degrades to a generic ``InvokeError`` and per-type
    error handling / observability breaks — this test turns that into a loud failure.
    """
    from graphon.model_runtime.errors.invoke import InvokeError
    from graphon.model_runtime.model_providers.base.ai_model import AIModel

    class _ProbeModel:
        _invoke_error_mapping = AIModel._invoke_error_mapping
        provider_display_name = "probe"

    assert issubclass(InvokeError, ValueError)

    error = FirstTokenTimeoutError("The first token was not received within 1.5s.")
    transformed = AIModel._transform_invoke_error(_ProbeModel(), error)  # type: ignore[arg-type]

    assert transformed is error

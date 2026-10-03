from libs.durable_stream import CursorUnavailableError, DurableStreamError, DurableStreamUnavailableError


def test_public_errors_share_durable_stream_base() -> None:
    assert issubclass(CursorUnavailableError, DurableStreamError)
    assert issubclass(DurableStreamUnavailableError, DurableStreamError)

import threading

import pytest

from core.virtual_environment.__base.command_future import (
    CommandCancelledError,
    CommandFuture,
    CommandTimeoutError,
)
from core.virtual_environment.__base.entities import CommandStatus
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.transport import NopTransportWriteCloser


def _make_future(
    stdout: bytes = b"",
    stderr: bytes = b"",
    exit_code: int = 0,
    delay_completion: float = 0,
    close_streams: bool = True,
) -> CommandFuture:
    stdout_transport = QueueTransportReadCloser()
    stderr_transport = QueueTransportReadCloser()

    if stdout:
        stdout_transport.get_write_handler().write(stdout)
    if stderr:
        stderr_transport.get_write_handler().write(stderr)

    if close_streams:
        stdout_transport.close()
        stderr_transport.close()

    completion_event = threading.Event()
    if delay_completion == 0:
        completion_event.set()
    else:
        threading.Timer(delay_completion, completion_event.set).start()

    def poll_status() -> CommandStatus:
        if completion_event.is_set():
            return CommandStatus(status=CommandStatus.Status.COMPLETED, exit_code=exit_code)
        return CommandStatus(status=CommandStatus.Status.RUNNING, exit_code=None)

    return CommandFuture(
        pid="test-pid",
        stdin_transport=NopTransportWriteCloser(),
        stdout_transport=stdout_transport,
        stderr_transport=stderr_transport,
        poll_status=poll_status,
        poll_interval=0.05,
    )


def test_result_returns_command_output():
    future = _make_future(stdout=b"hello\n", stderr=b"world\n", exit_code=0)

    result = future.result()

    assert result.stdout == b"hello\n"
    assert result.stderr == b"world\n"
    assert result.exit_code == 0
    assert result.pid == "test-pid"


def test_result_with_timeout_succeeds_when_command_completes_in_time():
    future = _make_future(stdout=b"ok", delay_completion=0.1)

    result = future.result(timeout=5.0)

    assert result.stdout == b"ok"


def test_result_raises_timeout_error_when_exceeded():
    future = _make_future(delay_completion=10.0, close_streams=False)

    with pytest.raises(CommandTimeoutError):
        future.result(timeout=0.2)


def test_done_returns_false_while_running():
    future = _make_future(delay_completion=10.0, close_streams=False)

    assert future.done() is False


def test_done_returns_true_after_completion():
    future = _make_future(stdout=b"done")

    future.result()

    assert future.done() is True


def test_cancel_returns_true_and_sets_cancelled():
    future = _make_future(delay_completion=10.0, close_streams=False)

    assert future.cancel() is True
    assert future.cancelled() is True


def test_cancel_returns_false_if_already_completed():
    future = _make_future(stdout=b"done")
    future.result()

    assert future.cancel() is False
    assert future.cancelled() is False


def test_result_raises_cancelled_error_after_cancel():
    future = _make_future(delay_completion=10.0, close_streams=False)
    future.cancel()

    with pytest.raises(CommandCancelledError):
        future.result()


def test_nonzero_exit_code_is_returned():
    future = _make_future(stdout=b"err", exit_code=42)

    result = future.result()

    assert result.exit_code == 42

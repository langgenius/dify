from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Callable, Mapping
from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters import feishu_lark as adapter_module
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    FeishuIMProviderAdapter,
    LarkIMIntegrationCredentials,
    LarkIMProviderAdapter,
)
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    EventAcceptance,
    IMStreamStartError,
    IMStreamStopError,
)


class _UnusedGateway:
    def query_tenant(self) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")

    def list_scope(self, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")

    def list_departments(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")

    def list_users(self, _department_id: str, _page_token: str | None) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")

    def create_message(self, _receive_id: str, _msg_type: str, _content: str) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")

    def patch_message(self, _message_id: str, _content: str) -> Mapping[str, object]:
        raise AssertionError("unexpected gateway call")


class _RecordingConsumer:
    def __init__(
        self,
        trace: list[str],
        acceptance: EventAcceptance = EventAcceptance.ACCEPTED,
    ) -> None:
        self._trace = trace
        self._acceptance = acceptance
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self._trace.append("consumer")
        self.events.append(event)
        return self._acceptance


class _BlockingConsumer:
    def __init__(self, trace: list[str]) -> None:
        self._trace = trace
        self.entered = threading.Event()
        self.release = threading.Event()
        self.events: list[AuthenticatedIMEvent] = []

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        self._trace.append("consumer-start")
        self.events.append(event)
        self.entered.set()
        assert self.release.wait(timeout=2)
        self._trace.append("consumer-end")
        return EventAcceptance.ACCEPTED


class _FailingConsumer:
    def __init__(self) -> None:
        self.attempts = 0

    def accept(self, event: AuthenticatedIMEvent) -> EventAcceptance:
        del event
        self.attempts += 1
        raise RuntimeError("sensitive consumer details")


class _FakeStreamClient:
    def __init__(
        self,
        callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        trace: list[str],
        *,
        start_error: Exception | None = None,
    ) -> None:
        self._callback = callback
        self._trace = trace
        self._start_error = start_error
        self.start_calls = 0
        self.stop_calls = 0

    def start(self) -> None:
        self.start_calls += 1
        self._trace.append("sdk-start")
        if self._start_error is not None:
            raise self._start_error
        self._trace.append("sdk-ready")

    def stop(self) -> None:
        self.stop_calls += 1
        self._trace.append("sdk-stop")

    def emit(self, event: Mapping[str, object], *, ack_error: Exception | None = None) -> None:
        def ack() -> None:
            self._trace.append("ack")
            if ack_error is not None:
                raise ack_error

        self._callback(event, ack)


class _BlockingCloseStreamClient(_FakeStreamClient):
    def __init__(
        self,
        callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        trace: list[str],
    ) -> None:
        super().__init__(callback, trace)
        self.close_started = threading.Event()
        self.release_close = threading.Event()

    def stop(self) -> None:
        self.stop_calls += 1
        self._trace.append("sdk-stop-start")
        self.close_started.set()
        assert self.release_close.wait(timeout=2)
        self._trace.append("sdk-stop-end")


class _BlockingFailingCloseStreamClient(_BlockingCloseStreamClient):
    def __init__(
        self,
        callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        trace: list[str],
        sensitive_marker: str,
    ) -> None:
        super().__init__(callback, trace)
        self._sensitive_marker = sensitive_marker

    def stop(self) -> None:
        self.stop_calls += 1
        self._trace.append("sdk-stop-start")
        self.close_started.set()
        assert self.release_close.wait(timeout=2)
        self._trace.append("sdk-stop-failed")
        raise RuntimeError(self._sensitive_marker)


class _BlockingStartStreamClient(_FakeStreamClient):
    def __init__(
        self,
        callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        trace: list[str],
    ) -> None:
        super().__init__(callback, trace)
        self.start_entered = threading.Event()
        self.cancel_start = threading.Event()

    def start(self) -> None:
        self.start_calls += 1
        self._trace.append("sdk-start")
        self.start_entered.set()
        assert self.cancel_start.wait(timeout=2)
        raise RuntimeError("sensitive cancelled start details")

    def stop(self) -> None:
        self.stop_calls += 1
        self._trace.append("sdk-stop")
        self.cancel_start.set()


class _DeferredWireAckStreamClient(_FakeStreamClient):
    """Model the SDK boundary where ACK bytes are written after dispatcher return."""

    def __init__(
        self,
        callback: Callable[[Mapping[str, object], Callable[[], None]], None],
        trace: list[str],
    ) -> None:
        super().__init__(callback, trace)
        self.callback_returned = threading.Event()
        self.release_ack_write = threading.Event()
        self.ack_written = threading.Event()

    def emit(self, event: Mapping[str, object], *, ack_error: Exception | None = None) -> None:
        del ack_error
        acknowledged = False

        def decide_ack() -> None:
            nonlocal acknowledged
            acknowledged = True
            self._trace.append("ack-decided")

        self._callback(event, decide_ack)
        self.callback_returned.set()
        assert self.release_ack_write.wait(timeout=2)
        if acknowledged:
            self._trace.append("ack-written")
            self.ack_written.set()

    def stop(self) -> None:
        self.stop_calls += 1
        assert self.ack_written.wait(timeout=2)
        self._trace.append("sdk-stop")


def _event_payload(*, create_time: str = "1785981600000") -> Mapping[str, object]:
    return {
        "schema": "2.0",
        "header": {
            "event_id": "evt_sanitized_event",
            "event_type": "card.action.trigger",
            "create_time": create_time,
            "tenant_key": "tenant_sanitized",
        },
        "event": {
            "action": {
                "name": "approve",
                "value": {
                    "action_id": "approve",
                    "correlation_token": "opaque-correlation-token",
                },
            },
            "preserved": [1, None, True],
        },
    }


def _adapter(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
) -> FeishuIMProviderAdapter | LarkIMProviderAdapter:
    monkeypatch.setattr(adapter_module, "_create_sdk_gateway", lambda _credentials, _domain: _UnusedGateway())
    values = {
        "provider": provider,
        "app_id": "cli_sanitized_app",
        "app_secret": "sanitized-app-secret",
        "verification_token": "sanitized-verification-token",
        "encrypt_key": "sanitized-encrypt-key",
    }
    if provider is IMProvider.FEISHU:
        return FeishuIMProviderAdapter(FeishuIMIntegrationCredentials.model_validate(values))
    return LarkIMProviderAdapter(LarkIMIntegrationCredentials.model_validate(values))


def test_per_client_sdk_transport_owns_and_closes_its_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    from lark_oapi.ws import client as sdk_ws_client_module

    transport_connected = threading.Event()

    class WebSocketConnection:
        def __init__(self) -> None:
            self.closed = asyncio.Event()

        async def recv(self) -> bytes:
            await self.closed.wait()
            raise RuntimeError("sanitized connection closed")

        async def close(self) -> None:
            self.closed.set()

        async def send(self, _data: bytes) -> None:
            return

    async def connect(_url: str, **_kwargs: object) -> WebSocketConnection:
        transport_connected.set()
        return WebSocketConnection()

    monkeypatch.setattr(
        sdk_ws_client_module.Client,
        "_get_conn_url",
        lambda _self: "wss://sanitized.invalid/connect?device_id=device-sanitized&service_id=1",
    )
    monkeypatch.setattr(sdk_ws_client_module.websockets, "connect", connect)
    client = adapter_module._PerClientSDKWSClient(
        credentials=FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="cli_sanitized_app",
            app_secret="sanitized-app-secret",
            verification_token="sanitized-verification-token",
            encrypt_key="sanitized-encrypt-key",
        ),
        domain="https://open.feishu.cn",
        event_handler=object(),
    )
    start_errors: list[Exception] = []

    def start_client() -> None:
        try:
            client.start()
        except Exception as exc:
            start_errors.append(exc)

    start_thread = threading.Thread(target=start_client)
    start_thread.start()
    assert transport_connected.wait(timeout=2)

    client.stop()
    start_thread.join(timeout=2)

    assert not start_thread.is_alive()
    assert start_errors == []
    assert client._dify_loop.is_closed()


@pytest.mark.parametrize("provider", [IMProvider.FEISHU, IMProvider.LARK])
def test_factory_is_lazy_and_start_returns_only_after_sdk_ready(
    monkeypatch: pytest.MonkeyPatch,
    provider: IMProvider,
) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []

    def factory(_credentials, _domain, callback):
        client = _FakeStreamClient(callback, trace)
        clients.append(client)
        return client

    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", factory)
    stream = _adapter(monkeypatch, provider).create_stream_handler(_RecordingConsumer(trace))
    assert clients == []

    stream.start()

    assert trace == ["sdk-start", "sdk-ready"]
    assert len(clients) == 1
    with pytest.raises(IMStreamStartError):
        stream.start()
    assert len(clients) == 1
    stream.stop()


def test_official_stream_client_start_returns_after_channel_readiness(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class LoopBoundReadyChannel:
        def __init__(self, **_kwargs: object) -> None:
            self.ready = threading.Event()
            self.transport_started = threading.Event()
            self.release_transport = threading.Event()
            channels.append(self)

        async def connect_until_ready(self, *, timeout: float) -> None:
            del timeout
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, self._run_transport)
            assert self.transport_started.wait(timeout=2)
            self.ready.set()

        def _run_transport(self) -> None:
            self.transport_started.set()
            assert self.release_transport.wait(timeout=2)

        def stop(self) -> None:
            self.release_transport.set()

        def wait_for_pending_wire_acks(self) -> None:
            return

    channels: list[LoopBoundReadyChannel] = []
    monkeypatch.setattr(adapter_module, "_SynchronousEventChannel", LoopBoundReadyChannel)
    client = adapter_module._OfficialSDKStreamClient(
        FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="cli_sanitized_app",
            app_secret="sanitized-app-secret",
            verification_token="sanitized-verification-token",
            encrypt_key="sanitized-encrypt-key",
        ),
        "https://open.feishu.cn",
        lambda _event, _acknowledge: None,
    )
    channel = channels[0]
    returned = threading.Event()
    start_thread = threading.Thread(target=lambda: (client.start(), returned.set()))
    start_thread.start()
    assert channel.ready.wait(timeout=2)

    try:
        assert returned.wait(timeout=0.2), "start() remained blocked after the SDK reported readiness"
    finally:
        client.stop()
        start_thread.join(timeout=2)

    assert not start_thread.is_alive()


def test_private_sdk_dispatcher_seam_keeps_consumer_acceptance_as_ack_boundary() -> None:
    observed: list[Mapping[str, object]] = []
    credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )

    def accept(event: Mapping[str, object], acknowledge: Callable[[], None]) -> None:
        observed.append(event)
        acknowledge()

    channel = adapter_module._SynchronousEventChannel(
        credentials=credentials,
        domain="https://open.feishu.cn",
        callback=accept,
    )
    dispatcher = channel._build_dispatcher()
    payload = json.dumps(_event_payload(), separators=(",", ":")).encode()

    response = dispatcher._do_without_validation(payload)

    assert observed == [
        {
            "schema": "2.0",
            "header": {
                "event_id": "evt_sanitized_event",
                "create_time": "1785981600000",
                "event_type": "card.action.trigger",
                "tenant_key": "tenant_sanitized",
            },
            "event": {
                "action": {
                    "name": "approve",
                    "value": {
                        "action_id": "approve",
                        "correlation_token": "opaque-correlation-token",
                    },
                }
            },
        }
    ]
    assert response is not None

    rejecting_channel = adapter_module._SynchronousEventChannel(
        credentials=credentials,
        domain="https://open.feishu.cn",
        callback=lambda _event, _acknowledge: None,
    )
    with pytest.raises(RuntimeError, match="responsibility was not accepted"):
        rejecting_channel._build_dispatcher()._do_without_validation(payload)


def test_private_sdk_write_seam_tracks_wire_ack_completion() -> None:
    credentials = FeishuIMIntegrationCredentials(
        provider=IMProvider.FEISHU,
        app_id="cli_sanitized_app",
        app_secret="sanitized-app-secret",
        verification_token="sanitized-verification-token",
        encrypt_key="sanitized-encrypt-key",
    )
    channel = adapter_module._SynchronousEventChannel(
        credentials=credentials,
        domain="https://open.feishu.cn",
        callback=lambda _event, acknowledge: acknowledge(),
    )

    class DeferredWriteClient:
        def __init__(self) -> None:
            self.write_started = threading.Event()
            self.release_write: asyncio.Event | None = None

        async def _write_message(self, _data: bytes) -> None:
            self.write_started.set()
            assert self.release_write is not None
            await self.release_write.wait()

    client = DeferredWriteClient()

    async def exercise() -> None:
        client.release_write = asyncio.Event()
        channel._wire_ack_tracking_enabled = True
        channel._install_wire_ack_hook(client)
        payload = json.dumps(_event_payload(), separators=(",", ":")).encode()
        response = channel._build_dispatcher()._do_without_validation(payload)
        assert response is not None
        write_task = asyncio.create_task(client._write_message(b"wire-ack"))
        await asyncio.sleep(0)
        assert client.write_started.is_set()

        drain_returned = threading.Event()
        drain_thread = threading.Thread(target=lambda: (channel.wait_for_pending_wire_acks(), drain_returned.set()))
        drain_thread.start()
        assert not drain_returned.wait(timeout=0.2)

        client.release_write.set()
        await write_task
        drain_thread.join(timeout=2)
        assert drain_returned.is_set()

    asyncio.run(exercise())


def test_accepted_event_is_consumed_once_then_acked(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit(_event_payload())

    assert trace[-2:] == ["consumer", "ack"]
    assert len(consumer.events) == 1
    assert consumer.events[0].provider is IMProvider.FEISHU
    assert consumer.events[0].provider_tenant_id == "tenant_sanitized"
    assert '"preserved":[1,null,true]' in consumer.events[0].payload
    stream.stop()


@pytest.mark.parametrize(
    ("create_time", "expected"),
    [
        ("1704067200123456", datetime(2024, 1, 1, 0, 0, 0, 123456)),
        ("1704067200123", datetime(2024, 1, 1, 0, 0, 0, 123000)),
        ("not-a-timestamp", None),
        ("9" * 64, None),
    ],
    ids=("microseconds", "milliseconds", "malformed", "overflow"),
)
def test_stream_event_maps_confirmed_timestamp_units_safely(
    monkeypatch: pytest.MonkeyPatch,
    create_time: str,
    expected: datetime | None,
) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit(_event_payload(create_time=create_time))
    stream.stop()

    assert len(consumer.events) == 1
    assert consumer.events[0].occurred_at == expected


@pytest.mark.parametrize(
    "acceptance",
    [EventAcceptance.NOT_ACCEPTED],
)
def test_unaccepted_event_is_not_acked_or_replayed(
    monkeypatch: pytest.MonkeyPatch,
    acceptance: EventAcceptance,
) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace, acceptance)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit(_event_payload())

    assert trace.count("consumer") == 1
    assert "ack" not in trace
    stream.stop()


def test_consumer_exception_is_contained_without_ack_or_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _FailingConsumer()
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit(_event_payload())
    stream.stop()

    assert consumer.attempts == 1
    assert "ack" not in trace
    assert clients[0].stop_calls == 1


def test_malformed_callback_is_contained_and_stream_remains_usable(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit({"malformed": True})
    clients[0].emit(_event_payload())
    stream.stop()

    assert len(consumer.events) == 1
    assert trace.count("ack") == 1
    assert clients[0].stop_calls == 1


def test_stop_drains_consumer_and_ack_before_sdk_close(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _BlockingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()
    callback_thread = threading.Thread(target=clients[0].emit, args=(_event_payload(),))
    callback_thread.start()
    assert consumer.entered.wait(timeout=2)

    def stop_stream() -> None:
        stream.stop()
        trace.append("stop-return")

    stop_thread = threading.Thread(target=stop_stream)
    stop_thread.start()
    assert "sdk-stop" not in trace
    consumer.release.set()
    callback_thread.join(timeout=2)
    stop_thread.join(timeout=2)

    assert not callback_thread.is_alive()
    assert not stop_thread.is_alive()
    assert trace[-5:] == ["consumer-start", "consumer-end", "ack", "sdk-stop", "stop-return"]


def test_stop_waits_for_sdk_wire_ack_after_dispatcher_callback_returns(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_DeferredWireAckStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(_DeferredWireAckStreamClient(callback, trace)) or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    stream.start()
    emit_thread = threading.Thread(target=clients[0].emit, args=(_event_payload(),))
    emit_thread.start()
    assert clients[0].callback_returned.wait(timeout=2)
    stop_returned = threading.Event()
    stop_thread = threading.Thread(target=lambda: (stream.stop(), trace.append("stop-return"), stop_returned.set()))
    stop_thread.start()

    try:
        assert not stop_returned.wait(timeout=0.2), "stop() returned before the SDK wrote the accepted ACK"
    finally:
        clients[0].release_ack_write.set()
        emit_thread.join(timeout=2)
        stop_thread.join(timeout=2)

    assert clients[0].ack_written.is_set()
    assert trace.index("ack-written") < trace.index("sdk-stop") < trace.index("stop-return")


def test_callback_after_stop_never_consumes_or_acks(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()
    stream.stop()

    clients[0].emit(_event_payload())

    assert consumer.events == []
    assert "ack" not in trace
    assert clients[0].stop_calls == 1


def test_concurrent_repeated_stop_waits_for_the_single_sdk_close(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_BlockingCloseStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(_BlockingCloseStreamClient(callback, trace)) or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    stream.start()
    first_returned = threading.Event()
    second_returned = threading.Event()

    first_stop = threading.Thread(target=lambda: (stream.stop(), first_returned.set()))
    first_stop.start()
    assert clients[0].close_started.wait(timeout=2)

    second_stop = threading.Thread(target=lambda: (stream.stop(), second_returned.set()))
    second_stop.start()
    assert not second_returned.wait(timeout=0.1)

    clients[0].release_close.set()
    first_stop.join(timeout=2)
    second_stop.join(timeout=2)

    assert not first_stop.is_alive()
    assert not second_stop.is_alive()
    assert first_returned.is_set()
    assert second_returned.is_set()
    assert clients[0].stop_calls == 1
    assert trace[-2:] == ["sdk-stop-start", "sdk-stop-end"]

    stream.stop()

    assert clients[0].stop_calls == 1


def test_stop_surfaces_operator_safe_error_when_sdk_close_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    sensitive_marker = "sensitive SDK close details"

    class CloseFailingStreamClient(_FakeStreamClient):
        def stop(self) -> None:
            self.stop_calls += 1
            raise RuntimeError(sensitive_marker)

    trace: list[str] = []
    clients: list[CloseFailingStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(CloseFailingStreamClient(callback, trace)) or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    stream.start()

    with pytest.raises(IMStreamStopError) as stop_error:
        stream.stop()

    assert sensitive_marker not in str(stop_error.value)
    assert clients[0].stop_calls == 1


def test_failed_close_propagates_to_concurrent_and_repeated_stop_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    sensitive_marker = "sensitive concurrent SDK close details"
    trace: list[str] = []
    clients: list[_BlockingFailingCloseStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(_BlockingFailingCloseStreamClient(callback, trace, sensitive_marker)) or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    stream.start()
    errors: list[IMStreamStopError | None] = [None, None]
    returned = [threading.Event(), threading.Event()]

    def stop_stream(index: int) -> None:
        try:
            stream.stop()
        except IMStreamStopError as error:
            errors[index] = error
        finally:
            returned[index].set()

    first_stop = threading.Thread(target=stop_stream, args=(0,))
    first_stop.start()
    assert clients[0].close_started.wait(timeout=2)

    second_stop = threading.Thread(target=stop_stream, args=(1,))
    second_stop.start()
    assert not returned[1].wait(timeout=0.1)

    clients[0].release_close.set()
    first_stop.join(timeout=2)
    second_stop.join(timeout=2)

    assert not first_stop.is_alive()
    assert not second_stop.is_alive()
    safe_errors = [error for error in errors if error is not None]
    assert len(safe_errors) == 2
    assert len({str(error) for error in safe_errors}) == 1
    assert all(sensitive_marker not in str(error) for error in safe_errors)

    with pytest.raises(IMStreamStopError) as repeated_error:
        stream.stop()

    assert str(repeated_error.value) == str(safe_errors[0])
    assert sensitive_marker not in str(repeated_error.value)
    assert clients[0].stop_calls == 1
    assert trace[-2:] == ["sdk-stop-start", "sdk-stop-failed"]


def test_stop_during_start_closes_client_and_both_calls_finish(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_BlockingStartStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(_BlockingStartStreamClient(callback, trace)) or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    start_errors: list[IMStreamStartError] = []

    def start_stream() -> None:
        try:
            stream.start()
        except IMStreamStartError as error:
            start_errors.append(error)

    start_thread = threading.Thread(target=start_stream)
    start_thread.start()
    assert clients[0].start_entered.wait(timeout=2)
    stop_thread = threading.Thread(target=stream.stop)
    stop_thread.start()
    start_thread.join(timeout=2)
    stop_thread.join(timeout=2)

    assert not start_thread.is_alive()
    assert not stop_thread.is_alive()
    assert len(start_errors) == 1
    assert "sensitive cancelled start details" not in str(start_errors[0])
    assert clients[0].stop_calls == 1
    assert trace == ["sdk-start", "sdk-stop"]


def test_stop_waits_when_failed_start_claims_a_slow_sdk_close(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    factory_entered = threading.Event()
    release_factory = threading.Event()
    close_started = threading.Event()
    release_close = threading.Event()
    stop_waiting_for_client = threading.Event()

    class SlowCloseClient:
        def start(self) -> None:
            raise AssertionError("start must be cancelled before the client is invoked")

        def stop(self) -> None:
            trace.append("sdk-close-start")
            close_started.set()
            assert release_close.wait(timeout=2)
            trace.append("sdk-close-end")

    def factory(_credentials, _domain, _callback):
        trace.append("factory-enter")
        factory_entered.set()
        assert release_factory.wait(timeout=2)
        trace.append("factory-return")
        return SlowCloseClient()

    class ResumeStopAfterCloseClaim(threading.Condition):
        def __init__(self) -> None:
            super().__init__()
            self.blocked_thread: threading.Thread | None = None
            self._blocked_once = False

        def wait(self, timeout: float | None = None) -> bool:
            if threading.current_thread() is self.blocked_thread and not self._blocked_once:
                stop_waiting_for_client.set()
            result = super().wait(timeout)
            if threading.current_thread() is self.blocked_thread and not self._blocked_once:
                self._blocked_once = True
                self.release()
                try:
                    assert close_started.wait(timeout=2)
                finally:
                    self.acquire()
            return result

    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", factory)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))
    condition = ResumeStopAfterCloseClaim()
    stream._condition = condition
    start_errors: list[IMStreamStartError] = []
    stop_returned = threading.Event()

    def start_stream() -> None:
        try:
            stream.start()
        except IMStreamStartError as error:
            start_errors.append(error)
            trace.append("start-error")

    def stop_stream() -> None:
        stream.stop()
        trace.append("stop-return")
        stop_returned.set()

    start_thread = threading.Thread(target=start_stream)
    start_thread.start()
    assert factory_entered.wait(timeout=2)
    stop_thread = threading.Thread(target=stop_stream)
    condition.blocked_thread = stop_thread
    stop_thread.start()
    assert stop_waiting_for_client.wait(timeout=2)
    release_factory.set()
    assert close_started.wait(timeout=2)

    returned_before_close = stop_returned.wait(timeout=0.2)
    release_close.set()
    start_thread.join(timeout=2)
    stop_thread.join(timeout=2)

    assert not start_thread.is_alive()
    assert not stop_thread.is_alive()
    assert len(start_errors) == 1
    assert not returned_before_close, f"stop() returned before SDK close completed: {trace}"
    assert trace.index("sdk-close-end") < trace.index("stop-return")


def test_stop_before_start_prevents_client_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))

    stream.stop()
    with pytest.raises(IMStreamStartError):
        stream.start()

    assert clients == []


def test_stream_wrappers_have_equivalent_observable_lifecycle_traces(monkeypatch: pytest.MonkeyPatch) -> None:
    traces: dict[str, list[str]] = {
        "https://open.feishu.cn": [],
        "https://open.larksuite.com": [],
    }
    clients: dict[str, _FakeStreamClient] = {}

    def factory(_credentials, domain, callback):
        client = _FakeStreamClient(callback, traces[domain])
        clients[domain] = client
        return client

    monkeypatch.setattr(adapter_module, "_create_sdk_stream_client", factory)
    observed_providers: list[IMProvider] = []
    for provider, domain in (
        (IMProvider.FEISHU, "https://open.feishu.cn"),
        (IMProvider.LARK, "https://open.larksuite.com"),
    ):
        consumer = _RecordingConsumer(traces[domain])
        stream = _adapter(monkeypatch, provider).create_stream_handler(consumer)
        stream.start()
        clients[domain].emit(_event_payload())
        stream.stop()
        observed_providers.append(consumer.events[0].provider)

    assert (
        traces["https://open.feishu.cn"]
        == traces["https://open.larksuite.com"]
        == [
            "sdk-start",
            "sdk-ready",
            "consumer",
            "ack",
            "sdk-stop",
        ]
    )
    assert observed_providers == [IMProvider.FEISHU, IMProvider.LARK]


def test_start_failure_closes_partial_client_and_is_operator_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    sensitive_marker = "sensitive SDK credential details"
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: (
            clients.append(_FakeStreamClient(callback, trace, start_error=RuntimeError(sensitive_marker)))
            or clients[-1]
        ),
    )
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(_RecordingConsumer(trace))

    with pytest.raises(IMStreamStartError) as stream_error:
        stream.start()

    assert sensitive_marker not in str(stream_error.value)
    assert clients[0].stop_calls == 1
    assert trace == ["sdk-start", "sdk-stop"]
    with pytest.raises(IMStreamStartError):
        stream.start()
    assert len(clients) == 1


def test_ack_failure_is_contained_and_stop_still_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    consumer = _RecordingConsumer(trace)
    stream = _adapter(monkeypatch, IMProvider.FEISHU).create_stream_handler(consumer)
    stream.start()

    clients[0].emit(_event_payload(), ack_error=RuntimeError("sensitive ACK details"))
    stream.stop()

    assert len(consumer.events) == 1
    assert clients[0].stop_calls == 1


def test_root_close_does_not_stop_created_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    adapter = _adapter(monkeypatch, IMProvider.FEISHU)
    consumer = _RecordingConsumer(trace)
    stream = adapter.create_stream_handler(consumer)
    adapter.close()

    stream.start()
    clients[0].emit(_event_payload())
    stream.stop()

    assert len(consumer.events) == 1


def test_two_streams_have_independent_lifecycles(monkeypatch: pytest.MonkeyPatch) -> None:
    trace: list[str] = []
    clients: list[_FakeStreamClient] = []
    monkeypatch.setattr(
        adapter_module,
        "_create_sdk_stream_client",
        lambda _credentials, _domain, callback: clients.append(_FakeStreamClient(callback, trace)) or clients[-1],
    )
    adapter = _adapter(monkeypatch, IMProvider.FEISHU)
    first_consumer = _RecordingConsumer(trace)
    second_consumer = _RecordingConsumer(trace)
    first = adapter.create_stream_handler(first_consumer)
    second = adapter.create_stream_handler(second_consumer)
    first.start()
    second.start()

    first.stop()
    clients[1].emit(_event_payload())
    second.stop()

    assert first_consumer.events == []
    assert len(second_consumer.events) == 1
    assert [client.stop_calls for client in clients] == [1, 1]

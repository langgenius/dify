import json
from collections.abc import Iterator
from types import TracebackType
from typing import override

import httpx
import pytest

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from core.plugin.impl.base import BasePluginClient, _resolve_stream_timeout
from core.plugin.impl.first_token_timeout import (
    FirstTokenTimeoutError,
    first_token_backstop,
    first_token_grace,
)


class _StreamContext:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def __enter__(self) -> "_StreamContext":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        return False

    def iter_lines(self) -> Iterator[str]:
        yield from self._lines


def _timed_out(**_kwargs: object) -> _StreamContext:
    raise httpx.ReadTimeout("timed out")


class TestFirstTokenLadder:
    def test_grace_has_a_floor_and_a_ratio(self) -> None:
        assert first_token_grace(1.0) == pytest.approx(0.25)
        assert first_token_grace(2.0) == pytest.approx(0.25)
        assert first_token_grace(20.0) == pytest.approx(1.0)

    def test_the_backstop_sits_two_rungs_out(self) -> None:
        assert first_token_backstop(2.0) == pytest.approx(2.5)
        assert first_token_backstop(20.0) == pytest.approx(22.0)


class TestResolveStreamTimeout:
    def test_no_budget_leaves_the_configured_timeout_alone(self, monkeypatch: pytest.MonkeyPatch) -> None:
        base = httpx.Timeout(600.0)
        monkeypatch.setattr("core.plugin.impl.base.plugin_daemon_request_timeout", base)

        assert _resolve_stream_timeout(None) is base
        assert _resolve_stream_timeout(0) is base

    def test_a_budget_inside_the_window_does_not_narrow_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Narrowing would make the budget bound every inter-token gap as well."""
        base = httpx.Timeout(600.0)
        monkeypatch.setattr("core.plugin.impl.base.plugin_daemon_request_timeout", base)

        assert _resolve_stream_timeout(2.0) is base

    def test_a_budget_past_the_window_widens_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        base = httpx.Timeout(600.0)
        monkeypatch.setattr("core.plugin.impl.base.plugin_daemon_request_timeout", base)

        resolved = _resolve_stream_timeout(900.0)

        assert resolved is not None
        assert resolved.read == pytest.approx(first_token_backstop(900.0))
        assert resolved.connect == base.connect
        assert resolved.write == base.write

    def test_an_unlimited_window_stays_unlimited(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("core.plugin.impl.base.plugin_daemon_request_timeout", None)

        assert _resolve_stream_timeout(2.0) is None


class TestStreamRequestBackstop:
    def test_a_read_timeout_before_any_frame_is_named_as_a_first_token_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("core.plugin.impl.base._httpx_client.stream", _timed_out)

        with pytest.raises(FirstTokenTimeoutError) as excinfo:
            list(BasePluginClient()._stream_request("POST", "some/path", first_token_timeout=2.0))

        assert "2.0" in str(excinfo.value)

    def test_a_read_timeout_after_a_frame_is_a_plain_transport_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class _StalledAfterFirstFrame(_StreamContext):
            @override
            def iter_lines(self) -> Iterator[str]:
                yield "data: first"
                raise httpx.ReadTimeout("timed out")

        monkeypatch.setattr(
            "core.plugin.impl.base._httpx_client.stream",
            lambda **_kwargs: _StalledAfterFirstFrame([]),
        )

        stream = BasePluginClient()._stream_request("POST", "some/path", first_token_timeout=2.0)
        assert next(stream) == "first"

        with pytest.raises(PluginDaemonInnerError):
            next(stream)

    def test_a_read_timeout_without_a_budget_is_a_plain_transport_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("core.plugin.impl.base._httpx_client.stream", _timed_out)

        with pytest.raises(PluginDaemonInnerError):
            list(BasePluginClient()._stream_request("POST", "some/path"))


class TestTypedErrorFrames:
    def test_the_daemon_gate_maps_to_a_first_token_timeout(self) -> None:
        with pytest.raises(FirstTokenTimeoutError) as excinfo:
            BasePluginClient()._handle_plugin_daemon_error(
                "FirstTokenTimeoutError",
                "no token was received within 2s",
            )

        assert "no token was received within 2s" in str(excinfo.value)

    def test_the_plugin_gate_maps_to_a_first_token_timeout(self) -> None:
        message = json.dumps(
            {
                "error_type": "FirstTokenTimeoutError",
                "message": "The first token was not received within 2.0s.",
                "args": {},
            }
        )

        with pytest.raises(FirstTokenTimeoutError) as excinfo:
            BasePluginClient()._handle_plugin_daemon_error("PluginInvokeError", message)

        assert "The first token was not received within 2.0s." in str(excinfo.value)

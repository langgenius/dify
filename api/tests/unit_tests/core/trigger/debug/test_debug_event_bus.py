"""
Tests for core.trigger.debug.event_bus.TriggerDebugEventBus.

Covers: Lua-script dispatch/poll with Redis error resilience.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from redis import RedisError

from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.events import PluginTriggerDebugEvent


class TestDispatch:
    @patch("core.trigger.debug.event_bus.redis_client")
    def test_returns_dispatch_count(self, mock_redis):
        mock_redis.eval.return_value = 3
        event = MagicMock()
        event.model_dump_json.return_value = '{"test": true}'

        result = TriggerDebugEventBus.dispatch("tenant-1", event, "pool:key")

        assert result == 3
        mock_redis.eval.assert_called_once()

    @patch("core.trigger.debug.event_bus.redis_client")
    def test_redis_error_returns_zero(self, mock_redis):
        mock_redis.eval.side_effect = RedisError("connection lost")
        event = MagicMock()
        event.model_dump_json.return_value = "{}"

        result = TriggerDebugEventBus.dispatch("tenant-1", event, "pool:key")

        assert result == 0


class TestPoll:
    @patch("core.trigger.debug.event_bus.redis_client")
    def test_returns_deserialized_event(self, mock_redis):
        event_json = PluginTriggerDebugEvent(
            timestamp=100,
            name="push",
            user_id="u1",
            request_id="r1",
            subscription_id="s1",
            provider_id="p1",
        ).model_dump_json()
        mock_redis.eval.return_value = event_json

        result = TriggerDebugEventBus.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key="pool:key",
            tenant_id="t1",
            user_id="u1",
            app_id="a1",
            node_id="n1",
        )

        assert result is not None
        assert result.name == "push"

    @patch("core.trigger.debug.event_bus.redis_client")
    def test_returns_none_when_no_event(self, mock_redis):
        mock_redis.eval.return_value = None

        result = TriggerDebugEventBus.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key="pool:key",
            tenant_id="t1",
            user_id="u1",
            app_id="a1",
            node_id="n1",
        )

        assert result is None

    @patch("core.trigger.debug.event_bus.redis_client")
    def test_redis_error_returns_none(self, mock_redis):
        mock_redis.eval.side_effect = RedisError("timeout")

        result = TriggerDebugEventBus.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key="pool:key",
            tenant_id="t1",
            user_id="u1",
            app_id="a1",
            node_id="n1",
        )

        assert result is None

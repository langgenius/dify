"""Tests for the ConditionalRetryLayer."""

import importlib.util
import os
import sys
import types as _types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# Load the module directly from file to avoid the heavy import chain
# from core.app.workflow.__init__ -> DifyNodeFactory -> sqlalchemy
_module_path = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "..", "..", "..", "..",
    "core", "app", "workflow", "layers", "conditional_retry.py",
)
_module_path = os.path.normpath(_module_path)
_spec = importlib.util.spec_from_file_location("conditional_retry", _module_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

ConditionalRetryLayer = _mod.ConditionalRetryLayer
RetryConditionOperator = _mod.RetryConditionOperator
_get_retry_condition = _mod._get_retry_condition
evaluate_retry_condition = _mod.evaluate_retry_condition


class TestEvaluateRetryCondition:
    """Tests for the evaluate_retry_condition function."""

    def test_condition_not_enabled_returns_true(self):
        condition = {"enabled": False, "error_filter": {"operator": "contains", "value": "timeout"}}
        assert evaluate_retry_condition("some error", condition) is True

    def test_empty_error_filter_returns_true(self):
        condition = {"enabled": True, "error_filter": None}
        assert evaluate_retry_condition("some error", condition) is True

    def test_empty_pattern_value_returns_true(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": ""}}
        assert evaluate_retry_condition("some error", condition) is True

    def test_contains_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        assert evaluate_retry_condition("Connection timeout occurred", condition) is True

    def test_contains_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        assert evaluate_retry_condition("Permission denied", condition) is False

    def test_contains_case_insensitive(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "TIMEOUT"}}
        assert evaluate_retry_condition("connection timeout", condition) is True

    def test_not_contains_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "not-contains", "value": "timeout"}}
        assert evaluate_retry_condition("Permission denied", condition) is True

    def test_not_contains_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "not-contains", "value": "timeout"}}
        assert evaluate_retry_condition("Connection timeout", condition) is False

    def test_starts_with_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "starts-with", "value": "connection"}}
        assert evaluate_retry_condition("Connection refused", condition) is True

    def test_starts_with_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "starts-with", "value": "connection"}}
        assert evaluate_retry_condition("Error: connection refused", condition) is False

    def test_ends_with_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "ends-with", "value": "refused"}}
        assert evaluate_retry_condition("Connection refused", condition) is True

    def test_ends_with_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "ends-with", "value": "refused"}}
        assert evaluate_retry_condition("Connection refused: port 80", condition) is False

    def test_equals_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "equals", "value": "timeout"}}
        assert evaluate_retry_condition("Timeout", condition) is True

    def test_equals_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "equals", "value": "timeout"}}
        assert evaluate_retry_condition("Connection timeout", condition) is False

    def test_not_equals_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "not-equals", "value": "timeout"}}
        assert evaluate_retry_condition("Connection error", condition) is True

    def test_not_equals_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "not-equals", "value": "timeout"}}
        assert evaluate_retry_condition("Timeout", condition) is False

    def test_regex_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "regex", "value": r"(429|503|timeout)"}}
        assert evaluate_retry_condition("HTTP error 429: Too Many Requests", condition) is True

    def test_regex_no_match(self):
        condition = {"enabled": True, "error_filter": {"operator": "regex", "value": r"(429|503|timeout)"}}
        assert evaluate_retry_condition("HTTP error 404: Not Found", condition) is False

    def test_regex_invalid_pattern_returns_true(self):
        condition = {"enabled": True, "error_filter": {"operator": "regex", "value": "[invalid"}}
        assert evaluate_retry_condition("some error", condition) is True

    def test_unknown_operator_returns_true(self):
        condition = {"enabled": True, "error_filter": {"operator": "unknown-op", "value": "test"}}
        assert evaluate_retry_condition("some error", condition) is True


class TestGetRetryCondition:
    """Tests for the _get_retry_condition helper."""

    def test_returns_none_when_no_node_data(self):
        node = SimpleNamespace(node_data=None)
        assert _get_retry_condition(node) is None

    def test_returns_condition_from_pydantic_extra(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        node_data = SimpleNamespace(__pydantic_extra__={"retry_condition": condition})
        node = SimpleNamespace(node_data=node_data)
        assert _get_retry_condition(node) == condition

    def test_returns_none_when_no_condition(self):
        node_data = SimpleNamespace(__pydantic_extra__={})
        node_data.get = lambda key, default=None: None
        node = SimpleNamespace(node_data=node_data)
        assert _get_retry_condition(node) is None

    def test_returns_condition_from_get_method(self):
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        node_data = SimpleNamespace(__pydantic_extra__={})
        node_data.get = lambda key, default=None: condition if key == "retry_condition" else default
        node = SimpleNamespace(node_data=node_data)
        assert _get_retry_condition(node) == condition


class TestConditionalRetryLayer:
    """Tests for the ConditionalRetryLayer."""

    def _build_node(self, *, retry_enabled: bool = True, retry_condition=None):
        retry_config = SimpleNamespace(retry_enabled=retry_enabled)
        extras = {"retry_condition": retry_condition} if retry_condition else {}
        node_data = SimpleNamespace(
            retry_config=retry_config,
            __pydantic_extra__=extras,
        )
        node_data.get = lambda key, default=None: extras.get(key, default)
        node = SimpleNamespace(
            id="test-node",
            retry=retry_enabled,
            node_data=node_data,
        )
        return node

    def _build_failed_event(self, error: str = "Connection timeout"):
        from graphon.graph_events import NodeRunFailedEvent

        event = MagicMock(spec=NodeRunFailedEvent)
        event.error = error
        return event

    def test_skips_non_failed_events(self):
        layer = ConditionalRetryLayer()
        node = self._build_node()
        layer.on_node_run_end(node, error=None, result_event=MagicMock())
        assert node.node_data.retry_config.retry_enabled is True

    def test_skips_when_retry_not_enabled(self):
        layer = ConditionalRetryLayer()
        node = self._build_node(retry_enabled=False)
        event = self._build_failed_event("timeout")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is False

    def test_skips_when_no_condition(self):
        layer = ConditionalRetryLayer()
        node = self._build_node(retry_enabled=True, retry_condition=None)
        event = self._build_failed_event("timeout")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is True

    def test_skips_when_condition_not_enabled(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": False, "error_filter": {"operator": "contains", "value": "timeout"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("Permission denied")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is True

    def test_allows_retry_when_condition_matches(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("Connection timeout occurred")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is True

    def test_disables_retry_when_condition_does_not_match(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("Permission denied")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is False

    def test_uses_exception_error_when_event_error_empty(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": True, "error_filter": {"operator": "contains", "value": "timeout"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("")
        layer.on_node_run_end(node, error=TimeoutError("Connection timeout"), result_event=event)
        assert node.node_data.retry_config.retry_enabled is True

    def test_regex_condition_disables_retry_on_no_match(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": True, "error_filter": {"operator": "regex", "value": r"(429|503)"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("HTTP 404 Not Found")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is False

    def test_regex_condition_allows_retry_on_match(self):
        layer = ConditionalRetryLayer()
        condition = {"enabled": True, "error_filter": {"operator": "regex", "value": r"(429|503)"}}
        node = self._build_node(retry_enabled=True, retry_condition=condition)
        event = self._build_failed_event("HTTP 429 Too Many Requests")
        layer.on_node_run_end(node, error=None, result_event=event)
        assert node.node_data.retry_config.retry_enabled is True

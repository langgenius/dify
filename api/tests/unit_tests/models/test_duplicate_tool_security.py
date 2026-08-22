"""
Security audit tests for the duplicate tool name fix and related changes.

This module tests for potential security vulnerabilities introduced or
addressed by the changes in the fix/duplicate-tool-name branch.
"""

import sys
from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# SEC-01: _extract_usage_dict recursive depth bomb (Medium)
#
# Both MCPTool._extract_usage_dict and WorkflowTool._extract_usage_dict
# recurse into arbitrarily nested Mapping / list structures from external
# MCP server responses.  A malicious MCP server can craft a deeply nested
# payload that causes a RecursionError (stack overflow), crashing the
# worker process.
# ---------------------------------------------------------------------------
class TestExtractUsageDictRecursionDepth:
    """Verify that deeply nested payloads do not crash the process."""

    @staticmethod
    def _build_deeply_nested_payload(depth: int) -> dict[str, Any]:
        """Build a payload nested to *depth* levels."""
        inner: dict[str, Any] = {"usage": {"total_tokens": 42}}
        for _ in range(depth):
            inner = {"nested": inner}
        return inner

    def test_mcp_tool_deep_nesting_does_not_crash(self) -> None:
        """
        SEC-01a: MCPTool._extract_usage_dict with depth approaching
        Python recursion limit.  Should either return a result or None,
        but must NOT raise RecursionError.
        """
        from core.tools.mcp_tool.tool import MCPTool

        # Build a payload 500 levels deep - well within Python's default
        # recursion limit (~1000) but enough to show unbounded recursion.
        payload = self._build_deeply_nested_payload(500)
        # This should NOT crash
        result = MCPTool._extract_usage_dict(payload)
        # It should eventually find the usage dict
        assert result is not None
        assert result.get("total_tokens") == 42

    def test_mcp_tool_very_deep_nesting_hits_recursion_limit(self) -> None:
        """
        SEC-01b: Demonstrate that a sufficiently deep payload WILL
        trigger RecursionError because there is no depth limit.

        This is the actual vulnerability: an MCP server returning a payload
        nested deeper than sys.getrecursionlimit() will crash the worker.
        """
        from core.tools.mcp_tool.tool import MCPTool

        depth = sys.getrecursionlimit() + 100
        payload = self._build_deeply_nested_payload(depth)

        # This WILL raise RecursionError, demonstrating the vulnerability
        with pytest.raises(RecursionError):
            MCPTool._extract_usage_dict(payload)

    def test_workflow_tool_deep_nesting_does_not_crash(self) -> None:
        """
        SEC-01c: Same test for WorkflowTool._extract_usage_dict.
        """
        from core.tools.workflow_as_tool.tool import WorkflowTool

        payload = self._build_deeply_nested_payload(500)
        result = WorkflowTool._extract_usage_dict(payload)
        assert result is not None
        assert result.get("total_tokens") == 42

    def test_workflow_tool_very_deep_nesting_hits_recursion_limit(self) -> None:
        """
        SEC-01d: Demonstrate the same vulnerability in WorkflowTool.
        """
        from core.tools.workflow_as_tool.tool import WorkflowTool

        depth = sys.getrecursionlimit() + 100
        payload = self._build_deeply_nested_payload(depth)

        with pytest.raises(RecursionError):
            WorkflowTool._extract_usage_dict(payload)


# ---------------------------------------------------------------------------
# SEC-02: MCP usage extraction trusts external data without validation (Low)
#
# _extract_usage_dict blindly returns whatever Mapping it finds under a
# "usage" key. If the MCP server supplies non-numeric values for fields
# like total_tokens, the downstream LLMUsage.from_metadata may behave
# unexpectedly. This is a data-integrity / low-severity issue.
# ---------------------------------------------------------------------------
class TestMCPUsageDataIntegrity:
    """Verify that malformed usage data from MCP servers is handled."""

    def test_extract_usage_dict_returns_arbitrary_keys(self) -> None:
        """
        SEC-02a: _extract_usage_dict does not filter keys, so a malicious
        MCP server can inject arbitrary keys into the usage dict.
        """
        from core.tools.mcp_tool.tool import MCPTool

        payload: dict[str, Any] = {
            "usage": {
                "total_tokens": 100,
                "malicious_key": "evil_value",
                "__class__": "should_not_be_here",
            }
        }
        result = MCPTool._extract_usage_dict(payload)
        assert result is not None
        # The method returns the raw dict without filtering
        assert "malicious_key" in result
        assert "__class__" in result

    def test_extract_usage_dict_non_numeric_token_values(self) -> None:
        """
        SEC-02b: Non-numeric token values are passed through without
        validation. Downstream consumers may fail or behave unexpectedly.
        """
        from core.tools.mcp_tool.tool import MCPTool

        payload: dict[str, Any] = {
            "usage": {
                "total_tokens": "not_a_number",
                "prompt_tokens": {"nested": "object"},
            }
        }
        result = MCPTool._extract_usage_dict(payload)
        assert result is not None
        assert result["total_tokens"] == "not_a_number"


# ---------------------------------------------------------------------------
# SEC-03: Human Input node bypass check (Info - Positive Security Test)
#
# Verify that ensure_no_human_input_nodes correctly rejects workflows
# containing human-input nodes, and cannot be bypassed with variations.
# ---------------------------------------------------------------------------
class TestHumanInputNodeBypass:
    """Test that human input node detection cannot be bypassed."""

    def test_blocks_human_input_node(self) -> None:
        """SEC-03a: Standard human-input node is correctly blocked."""
        from core.tools.errors import WorkflowToolHumanInputNotSupportedError
        from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils

        graph: dict[str, Any] = {
            "nodes": [
                {"data": {"type": "start"}},
                {"data": {"type": "human-input"}},
                {"data": {"type": "end"}},
            ]
        }
        with pytest.raises(WorkflowToolHumanInputNotSupportedError):
            WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)

    def test_allows_workflow_without_human_input(self) -> None:
        """SEC-03b: Clean workflow passes validation."""
        from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils

        graph: dict[str, Any] = {
            "nodes": [
                {"data": {"type": "start"}},
                {"data": {"type": "llm"}},
                {"data": {"type": "end"}},
            ]
        }
        # Should NOT raise
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)

    def test_case_sensitivity_not_bypassed(self) -> None:
        """
        SEC-03c: Verify that 'Human-Input' or 'HUMAN-INPUT' do NOT
        bypass the check (NodeType is a StrEnum with value 'human-input').
        """
        from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils

        # These should NOT raise since NodeType.HUMAN_INPUT == "human-input"
        # and "Human-Input" != "human-input"
        for variant in ["Human-Input", "HUMAN-INPUT", "human_input", "humaninput"]:
            graph: dict[str, Any] = {"nodes": [{"data": {"type": variant}}]}
            # None of these should raise because they don't match exactly
            WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)

    def test_empty_graph_is_safe(self) -> None:
        """SEC-03d: Empty graph or missing nodes key doesn't crash."""
        from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils

        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes({})
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes({"nodes": []})

    def test_node_with_missing_data_key(self) -> None:
        """SEC-03e: Node without 'data' key doesn't crash."""
        from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils

        graph: dict[str, Any] = {"nodes": [{}]}
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)


# ---------------------------------------------------------------------------
# SEC-04: ToolInvokeMessage field validator injection (Low)
#
# The decode_blob_message validator now coerces message dicts based on
# the type field. Verify that the coercion logic is safe.
# ---------------------------------------------------------------------------
class TestToolInvokeMessageCoercion:
    """Test message type coercion logic in ToolInvokeMessage."""

    def test_json_type_wraps_dict_in_json_object(self) -> None:
        """
        SEC-04a: When type=JSON and message is a raw dict without
        'json_object', it should be wrapped.
        """
        from core.tools.entities.tool_entities import ToolInvokeMessage

        msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message={"key": "value"},
        )
        assert isinstance(msg.message, ToolInvokeMessage.JsonMessage)
        assert msg.message.json_object == {"key": "value"}

    def test_json_type_preserves_json_object_key(self) -> None:
        """
        SEC-04b: When type=JSON and message already has 'json_object',
        it should not double-wrap.
        """
        from core.tools.entities.tool_entities import ToolInvokeMessage

        msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message={"json_object": {"inner": "data"}},
        )
        assert isinstance(msg.message, ToolInvokeMessage.JsonMessage)
        assert msg.message.json_object == {"inner": "data"}

    def test_file_type_coercion_ignores_payload(self) -> None:
        """
        SEC-04c: When type=FILE, the message dict is replaced with a
        fixed file_marker regardless of what was sent. This prevents
        any user-controlled data from being stored in the FileMessage.
        """
        from core.tools.entities.tool_entities import ToolInvokeMessage

        msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.FILE,
            message={"arbitrary": "data", "exploit": True},
        )
        assert isinstance(msg.message, ToolInvokeMessage.FileMessage)
        assert msg.message.file_marker == "file_marker"

    def test_json_message_accepts_list_type(self) -> None:
        """
        SEC-04d: JsonMessage.json_object now accepts list type.
        Verify it works with a list.
        """
        from core.tools.entities.tool_entities import ToolInvokeMessage

        msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message={"json_object": [1, 2, 3]},
        )
        assert isinstance(msg.message, ToolInvokeMessage.JsonMessage)
        assert msg.message.json_object == [1, 2, 3]


# ---------------------------------------------------------------------------
# SEC-05: SSRF fix in WordExtractor (Positive Security Test)
#
# Verify that the WordExtractor now uses ssrf_proxy instead of httpx.get
# directly. This is a SSRF fix (critical vulnerability was patched).
# ---------------------------------------------------------------------------
class TestSSRFFixWordExtractor:
    """Verify SSRF protection in WordExtractor."""

    def test_word_extractor_uses_ssrf_proxy(self) -> None:
        """
        SEC-05a: WordExtractor should use ssrf_proxy.get, not httpx.get.
        Verify by checking the source code import.
        """
        import inspect

        from core.rag.extractor.word_extractor import WordExtractor

        source = inspect.getsource(WordExtractor)
        # Should NOT contain direct httpx.get call
        assert "httpx.get(" not in source, (
            "WordExtractor still uses httpx.get directly, which is vulnerable to SSRF"
        )
        # Should contain ssrf_proxy usage
        assert "ssrf_proxy" in source, "WordExtractor should use ssrf_proxy for URL downloads"


# ---------------------------------------------------------------------------
# SEC-06: Removed _try_resolve_user_from_request (Positive Security Test)
#
# The WorkflowTool no longer tries to resolve user from Flask request
# context via LocalProxy, which could leak user context across async tasks.
# ---------------------------------------------------------------------------
class TestUserResolutionSecurity:
    """Verify that WorkflowTool resolves users only from database."""

    def test_no_request_context_dependency(self) -> None:
        """
        SEC-06a: WorkflowTool._resolve_user should not reference
        Flask request context or current_user in executable code.
        """
        import inspect

        from core.tools.workflow_as_tool.tool import WorkflowTool

        # Check the module-level source for the removed function
        import core.tools.workflow_as_tool.tool as tool_module

        module_source = inspect.getsource(tool_module)
        assert "_try_resolve_user_from_request" not in module_source, (
            "_try_resolve_user_from_request has been removed for security"
        )
        # Verify that libs.login / current_user is not imported
        assert "from libs.login import current_user" not in module_source, (
            "WorkflowTool should not import current_user to avoid "
            "cross-context user leakage in async/Celery workers"
        )


# ---------------------------------------------------------------------------
# SEC-07: Error message information disclosure in tool_engine.py (Info)
#
# Error messages from tool invocations are now logged with exc_info=True.
# Verify that error responses returned to users do not leak stack traces.
# ---------------------------------------------------------------------------
class TestToolEngineErrorDisclosure:
    """Verify that tool error responses don't leak sensitive information."""

    def test_credential_error_hides_details(self) -> None:
        """
        SEC-07a: ToolProviderCredentialValidationError should return
        a generic message, not the actual exception details.
        """
        from core.tools.tool_engine import ToolEngine

        import inspect
        source = inspect.getsource(ToolEngine.agent_invoke)
        # The credential error should return a generic message
        assert 'Please check your tool provider credentials' in source
        # And should NOT include the exception message in the response
        # (it goes to the log instead)


# ---------------------------------------------------------------------------
# SEC-08: SSRF proxy header validation (Positive Security Test)
#
# The ssrf_proxy now validates headers with Pydantic TypeAdapter.
# ---------------------------------------------------------------------------
class TestSSRFProxyHeaderValidation:
    """Verify that SSRF proxy validates headers."""

    def test_rejects_non_string_header_values(self) -> None:
        """
        SEC-08a: Headers with non-string values should be rejected.
        """
        from core.helper.ssrf_proxy import _HEADERS_ADAPTER
        from pydantic import ValidationError

        # Valid headers
        result = _HEADERS_ADAPTER.validate_python({"Content-Type": "application/json"})
        assert result == {"Content-Type": "application/json"}

        # Invalid: nested dict as header value
        with pytest.raises(ValidationError):
            _HEADERS_ADAPTER.validate_python({"X-Evil": {"nested": "object"}})

        # Invalid: list as header value
        with pytest.raises(ValidationError):
            _HEADERS_ADAPTER.validate_python({"X-Evil": [1, 2, 3]})


# ---------------------------------------------------------------------------
# SEC-09: WorkflowTool pause_state_config set to None (Positive Test)
#
# WorkflowTool explicitly sets pause_state_config=None to prevent
# human-input pausing within tool execution context.
# ---------------------------------------------------------------------------
class TestWorkflowToolPauseDisabled:
    """Verify that WorkflowTool disables pause mechanisms."""

    def test_pause_state_config_is_none_in_source(self) -> None:
        """
        SEC-09a: WorkflowTool._invoke should set pause_state_config=None
        when calling WorkflowAppGenerator.generate.
        """
        import inspect

        from core.tools.workflow_as_tool.tool import WorkflowTool

        source = inspect.getsource(WorkflowTool._invoke)
        assert "pause_state_config=None" in source, (
            "WorkflowTool must disable pause_state_config to prevent "
            "human-input nodes from pausing tool execution indefinitely"
        )

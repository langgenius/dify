"""
Mock node implementations for testing.

This module provides mock implementations of nodes that require third-party services,
allowing tests to run without external dependencies.
"""

import time
from collections.abc import Generator, Mapping
from typing import TYPE_CHECKING, Any, Optional

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.agent import AgentNode
from core.workflow.nodes.document_extractor import DocumentExtractorNode
from core.workflow.nodes.http_request import HttpRequestNode
from core.workflow.nodes.knowledge_retrieval import KnowledgeRetrievalNode
from core.workflow.nodes.llm import LLMNode
from core.workflow.nodes.parameter_extractor import ParameterExtractorNode
from core.workflow.nodes.question_classifier import QuestionClassifierNode
from core.workflow.nodes.tool import ToolNode

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams, GraphRuntimeState

    from .test_mock_config import MockConfig


class MockNodeMixin:
    """Mixin providing common mock functionality."""

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        mock_config: Optional["MockConfig"] = None,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self.mock_config = mock_config

    def _get_mock_outputs(self, default_outputs: dict[str, Any]) -> dict[str, Any]:
        """Get mock outputs for this node."""
        if not self.mock_config:
            return default_outputs

        # Check for node-specific configuration
        node_config = self.mock_config.get_node_config(self._node_id)
        if node_config and node_config.outputs:
            return node_config.outputs

        # Check for custom handler
        if node_config and node_config.custom_handler:
            return node_config.custom_handler(self)

        return default_outputs

    def _should_simulate_error(self) -> Optional[str]:
        """Check if this node should simulate an error."""
        if not self.mock_config:
            return None

        node_config = self.mock_config.get_node_config(self._node_id)
        if node_config:
            return node_config.error

        return None

    def _simulate_delay(self) -> None:
        """Simulate execution delay if configured."""
        if not self.mock_config or not self.mock_config.simulate_delays:
            return

        node_config = self.mock_config.get_node_config(self._node_id)
        if node_config and node_config.delay > 0:
            time.sleep(node_config.delay)


class MockLLMNode(MockNodeMixin, LLMNode):
    """Mock implementation of LLMNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock LLM node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        default_response = self.mock_config.default_llm_response if self.mock_config else "Mocked LLM response"
        outputs = self._get_mock_outputs(
            {
                "text": default_response,
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            }
        )

        # Simulate streaming if text output exists
        if "text" in outputs:
            text = outputs["text"]
            # Send chunks
            for i in range(0, len(text), 10):
                chunk = text[i : i + 10]
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=chunk,
                    is_final=False,
                    chunk_content=chunk,
                    from_variable_selector=[self._node_id, "text"],
                )

            # Send final chunk
            yield StreamChunkEvent(
                selector=[self._node_id, "text"],
                chunk="",
                is_final=True,
                chunk_content="",
                from_variable_selector=[self._node_id, "text"],
            )

        # Create mock usage with all required fields
        usage = LLMUsage.empty_usage()
        usage.prompt_tokens = outputs.get("usage", {}).get("prompt_tokens", 10)
        usage.completion_tokens = outputs.get("usage", {}).get("completion_tokens", 5)
        usage.total_tokens = outputs.get("usage", {}).get("total_tokens", 15)

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"mock": "inputs"},
                process_data={
                    "model_mode": "chat",
                    "prompts": [],
                    "usage": outputs.get("usage", {}),
                    "finish_reason": outputs.get("finish_reason", "stop"),
                    "model_provider": "mock_provider",
                    "model_name": "mock_model",
                },
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.0,
                    WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
                },
                llm_usage=usage,
            )
        )


class MockAgentNode(MockNodeMixin, AgentNode):
    """Mock implementation of AgentNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock agent node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        default_response = self.mock_config.default_agent_response if self.mock_config else "Mocked agent response"
        outputs = self._get_mock_outputs(
            {
                "output": default_response,
                "files": [],
            }
        )

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"mock": "inputs"},
                process_data={
                    "agent_log": "Mock agent executed successfully",
                },
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.AGENT_LOG: "Mock agent log",
                },
            )
        )


class MockToolNode(MockNodeMixin, ToolNode):
    """Mock implementation of ToolNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock tool node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        default_response = (
            self.mock_config.default_tool_response if self.mock_config else {"result": "mocked tool output"}
        )
        outputs = self._get_mock_outputs(default_response)

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"mock": "inputs"},
                process_data={
                    "tool_name": "mock_tool",
                    "tool_parameters": {},
                },
                outputs=outputs,
                metadata={
                    WorkflowNodeExecutionMetadataKey.TOOL_INFO: {
                        "tool_name": "mock_tool",
                        "tool_label": "Mock Tool",
                    },
                },
            )
        )


class MockKnowledgeRetrievalNode(MockNodeMixin, KnowledgeRetrievalNode):
    """Mock implementation of KnowledgeRetrievalNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock knowledge retrieval node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        default_response = (
            self.mock_config.default_retrieval_response if self.mock_config else "Mocked retrieval content"
        )
        outputs = self._get_mock_outputs(
            {
                "result": [
                    {
                        "content": default_response,
                        "score": 0.95,
                        "metadata": {"source": "mock_source"},
                    }
                ],
            }
        )

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"query": "mock query"},
                process_data={
                    "retrieval_method": "mock",
                    "documents_count": 1,
                },
                outputs=outputs,
            )
        )


class MockHttpRequestNode(MockNodeMixin, HttpRequestNode):
    """Mock implementation of HttpRequestNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock HTTP request node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        default_response = (
            self.mock_config.default_http_response
            if self.mock_config
            else {
                "status_code": 200,
                "body": "mocked response",
                "headers": {},
            }
        )
        outputs = self._get_mock_outputs(default_response)

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"url": "http://mock.url", "method": "GET"},
                process_data={
                    "request_url": "http://mock.url",
                    "request_method": "GET",
                },
                outputs=outputs,
            )
        )


class MockQuestionClassifierNode(MockNodeMixin, QuestionClassifierNode):
    """Mock implementation of QuestionClassifierNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock question classifier node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response - default to first class
        outputs = self._get_mock_outputs(
            {
                "class_name": "class_1",
            }
        )

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"query": "mock query"},
                process_data={
                    "classification": outputs.get("class_name", "class_1"),
                },
                outputs=outputs,
                edge_source_handle=outputs.get("class_name", "class_1"),  # Branch based on classification
            )
        )


class MockParameterExtractorNode(MockNodeMixin, ParameterExtractorNode):
    """Mock implementation of ParameterExtractorNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock parameter extractor node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        outputs = self._get_mock_outputs(
            {
                "parameters": {
                    "param1": "value1",
                    "param2": "value2",
                },
            }
        )

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"text": "mock text"},
                process_data={
                    "extracted_parameters": outputs.get("parameters", {}),
                },
                outputs=outputs,
            )
        )


class MockDocumentExtractorNode(MockNodeMixin, DocumentExtractorNode):
    """Mock implementation of DocumentExtractorNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "mock-1"

    def _run(self) -> Generator:
        """Execute mock document extractor node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=error,
                    inputs={},
                    process_data={},
                    error_type="MockError",
                )
            )
            return

        # Get mock response
        outputs = self._get_mock_outputs(
            {
                "text": "Mocked extracted document content",
                "metadata": {
                    "pages": 1,
                    "format": "mock",
                },
            }
        )

        # Send completion event
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"file": "mock_file.pdf"},
                process_data={
                    "extraction_method": "mock",
                },
                outputs=outputs,
            )
        )

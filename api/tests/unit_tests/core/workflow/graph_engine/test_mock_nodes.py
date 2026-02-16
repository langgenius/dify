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
from core.workflow.nodes.code import CodeNode
from core.workflow.nodes.document_extractor import DocumentExtractorNode
from core.workflow.nodes.http_request import HttpRequestNode
from core.workflow.nodes.knowledge_retrieval import KnowledgeRetrievalNode
from core.workflow.nodes.llm import LLMNode
from core.workflow.nodes.parameter_extractor import ParameterExtractorNode
from core.workflow.nodes.question_classifier import QuestionClassifierNode
from core.workflow.nodes.template_transform import TemplateTransformNode
from core.workflow.nodes.tool import ToolNode

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState

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
        **kwargs: Any,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            **kwargs,
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

    def _should_simulate_error(self) -> str | None:
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
        return "1"

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
            text = str(outputs["text"])
            # Split text into words and stream with spaces between them
            # To match test expectation of text.count(" ") + 2 chunks
            words = text.split(" ")
            for i, word in enumerate(words):
                # Add space before word (except for first word) to reconstruct text properly
                if i > 0:
                    chunk = " " + word
                else:
                    chunk = word

                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=chunk,
                    is_final=False,
                )

            # Send final chunk
            yield StreamChunkEvent(
                selector=[self._node_id, "text"],
                chunk="",
                is_final=True,
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
        return "1"

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
        return "1"

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
        return "1"

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
        return "1"

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
        return "1"

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
        return "1"

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
        return "1"

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


from core.workflow.nodes.iteration import IterationNode
from core.workflow.nodes.loop import LoopNode


class MockIterationNode(MockNodeMixin, IterationNode):
    """Mock implementation of IterationNode that preserves mock configuration."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "1"

    def _create_graph_engine(self, index: int, item: Any):
        """Create a graph engine with MockNodeFactory instead of DifyNodeFactory."""
        # Import dependencies
        from core.workflow.entities import GraphInitParams
        from core.workflow.graph import Graph
        from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
        from core.workflow.graph_engine.command_channels import InMemoryChannel
        from core.workflow.runtime import GraphRuntimeState

        # Import our MockNodeFactory instead of DifyNodeFactory
        from .test_mock_factory import MockNodeFactory

        # Create GraphInitParams from node attributes
        graph_init_params = GraphInitParams(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_id=self.workflow_id,
            graph_config=self.graph_config,
            user_id=self.user_id,
            user_from=self.user_from.value,
            invoke_from=self.invoke_from.value,
            call_depth=self.workflow_call_depth,
        )

        # Create a deep copy of the variable pool for each iteration
        variable_pool_copy = self.graph_runtime_state.variable_pool.model_copy(deep=True)

        # append iteration variable (item, index) to variable pool
        variable_pool_copy.add([self._node_id, "index"], index)
        variable_pool_copy.add([self._node_id, "item"], item)

        # Create a new GraphRuntimeState for this iteration
        graph_runtime_state_copy = GraphRuntimeState(
            variable_pool=variable_pool_copy,
            start_at=self.graph_runtime_state.start_at,
            total_tokens=0,
            node_run_steps=0,
        )

        # Create a MockNodeFactory with the same mock_config
        node_factory = MockNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state_copy,
            mock_config=self.mock_config,  # Pass the mock configuration
        )

        # Initialize the iteration graph with the mock node factory
        iteration_graph = Graph.init(
            graph_config=self.graph_config, node_factory=node_factory, root_node_id=self._node_data.start_node_id
        )

        if not iteration_graph:
            from core.workflow.nodes.iteration.exc import IterationGraphNotFoundError

            raise IterationGraphNotFoundError("iteration graph not found")

        # Create a new GraphEngine for this iteration
        graph_engine = GraphEngine(
            workflow_id=self.workflow_id,
            graph=iteration_graph,
            graph_runtime_state=graph_runtime_state_copy,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
            config=GraphEngineConfig(),
        )

        return graph_engine


class MockLoopNode(MockNodeMixin, LoopNode):
    """Mock implementation of LoopNode that preserves mock configuration."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "1"

    def _create_graph_engine(self, start_at, root_node_id: str):
        """Create a graph engine with MockNodeFactory instead of DifyNodeFactory."""
        # Import dependencies
        from core.workflow.entities import GraphInitParams
        from core.workflow.graph import Graph
        from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
        from core.workflow.graph_engine.command_channels import InMemoryChannel
        from core.workflow.runtime import GraphRuntimeState

        # Import our MockNodeFactory instead of DifyNodeFactory
        from .test_mock_factory import MockNodeFactory

        # Create GraphInitParams from node attributes
        graph_init_params = GraphInitParams(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_id=self.workflow_id,
            graph_config=self.graph_config,
            user_id=self.user_id,
            user_from=self.user_from.value,
            invoke_from=self.invoke_from.value,
            call_depth=self.workflow_call_depth,
        )

        # Create a new GraphRuntimeState for this iteration
        graph_runtime_state_copy = GraphRuntimeState(
            variable_pool=self.graph_runtime_state.variable_pool,
            start_at=start_at.timestamp(),
        )

        # Create a MockNodeFactory with the same mock_config
        node_factory = MockNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state_copy,
            mock_config=self.mock_config,  # Pass the mock configuration
        )

        # Initialize the loop graph with the mock node factory
        loop_graph = Graph.init(graph_config=self.graph_config, node_factory=node_factory, root_node_id=root_node_id)

        if not loop_graph:
            raise ValueError("loop graph not found")

        # Create a new GraphEngine for this iteration
        graph_engine = GraphEngine(
            workflow_id=self.workflow_id,
            graph=loop_graph,
            graph_runtime_state=graph_runtime_state_copy,
            command_channel=InMemoryChannel(),  # Use InMemoryChannel for sub-graphs
            config=GraphEngineConfig(),
        )

        return graph_engine


class MockTemplateTransformNode(MockNodeMixin, TemplateTransformNode):
    """Mock implementation of TemplateTransformNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "1"

    def _run(self) -> NodeRunResult:
        """Execute mock template transform node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=error,
                inputs={},
                error_type="MockError",
            )

        # Get variables from the node data
        variables: dict[str, Any] = {}
        if hasattr(self._node_data, "variables"):
            for variable_selector in self._node_data.variables:
                variable_name = variable_selector.variable
                value = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
                variables[variable_name] = value.to_object() if value else None

        # Check if we have custom mock outputs configured
        if self.mock_config:
            node_config = self.mock_config.get_node_config(self._node_id)
            if node_config and node_config.outputs:
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=variables,
                    outputs=node_config.outputs,
                )

        # Try to actually process the template using Jinja2 directly
        try:
            if hasattr(self._node_data, "template"):
                # Import jinja2 here to avoid dependency issues
                from jinja2 import Template

                template = Template(self._node_data.template)
                result_text = template.render(**variables)

                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs={"output": result_text}
                )
        except Exception as e:
            # If direct Jinja2 fails, try CodeExecutor as fallback
            try:
                from core.helper.code_executor.code_executor import CodeExecutor, CodeLanguage

                if hasattr(self._node_data, "template"):
                    result = CodeExecutor.execute_workflow_code_template(
                        language=CodeLanguage.JINJA2, code=self._node_data.template, inputs=variables
                    )
                    return NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        inputs=variables,
                        outputs={"output": result["result"]},
                    )
            except Exception:
                # Both methods failed, fall back to default mock output
                pass

        # Fall back to default mock output
        default_response = (
            self.mock_config.default_template_transform_response if self.mock_config else "mocked template output"
        )
        default_outputs = {"output": default_response}
        outputs = self._get_mock_outputs(default_outputs)

        # Return result
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variables,
            outputs=outputs,
        )


class MockCodeNode(MockNodeMixin, CodeNode):
    """Mock implementation of CodeNode for testing."""

    @classmethod
    def version(cls) -> str:
        """Return the version of this mock node."""
        return "1"

    def _run(self) -> NodeRunResult:
        """Execute mock code node."""
        # Simulate delay if configured
        self._simulate_delay()

        # Check for simulated error
        error = self._should_simulate_error()
        if error:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=error,
                inputs={},
                error_type="MockError",
            )

        # Get mock outputs - use configured outputs or default based on output schema
        default_outputs = {}
        if hasattr(self._node_data, "outputs") and self._node_data.outputs:
            # Generate default outputs based on schema
            for output_name, output_config in self._node_data.outputs.items():
                if output_config.type == "string":
                    default_outputs[output_name] = f"mocked_{output_name}"
                elif output_config.type == "number":
                    default_outputs[output_name] = 42
                elif output_config.type == "object":
                    default_outputs[output_name] = {"key": "value"}
                elif output_config.type == "array[string]":
                    default_outputs[output_name] = ["item1", "item2"]
                elif output_config.type == "array[number]":
                    default_outputs[output_name] = [1, 2, 3]
                elif output_config.type == "array[object]":
                    default_outputs[output_name] = [{"key": "value1"}, {"key": "value2"}]
        else:
            # Default output when no schema is defined
            default_outputs = (
                self.mock_config.default_code_response
                if self.mock_config
                else {"result": "mocked code execution result"}
            )

        outputs = self._get_mock_outputs(default_outputs)

        # Return result
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            outputs=outputs,
        )

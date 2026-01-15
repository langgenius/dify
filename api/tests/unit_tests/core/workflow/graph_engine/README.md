# Graph Engine Testing Framework

## Overview

This directory contains a comprehensive testing framework for the Graph Engine, including:

1. **TableTestRunner** - Advanced table-driven test framework for workflow testing
1. **Auto-Mock System** - Powerful mocking framework for testing without external dependencies

## TableTestRunner Framework

The TableTestRunner (`test_table_runner.py`) provides a robust table-driven testing framework for GraphEngine workflows.

### Features

- **Table-driven testing** - Define test cases as structured data
- **Parallel test execution** - Run tests concurrently for faster execution
- **Property-based testing** - Integration with Hypothesis for fuzzing
- **Event sequence validation** - Verify correct event ordering
- **Mock configuration** - Seamless integration with the auto-mock system
- **Performance metrics** - Track execution times and bottlenecks
- **Detailed error reporting** - Comprehensive failure diagnostics

### Basic Usage

```python
from test_table_runner import TableTestRunner, WorkflowTestCase

# Create test runner
runner = TableTestRunner()

# Define test case
test_case = WorkflowTestCase(
    fixture_path="simple_workflow",
    inputs={"query": "Hello"},
    expected_outputs={"result": "World"},
    description="Basic workflow test",
)

# Run single test
result = runner.run_test_case(test_case)
assert result.success
```

### Advanced Features

#### Parallel Execution

```python
runner = TableTestRunner(max_workers=8)

test_cases = [
    WorkflowTestCase(...),
    WorkflowTestCase(...),
    # ... more test cases
]

# Run tests in parallel
suite_result = runner.run_table_tests(
    test_cases,
    parallel=True,
    fail_fast=False
)

print(f"Success rate: {suite_result.success_rate:.1f}%")
```

#### Event Sequence Validation

```python
from core.workflow.graph_events import (
    GraphRunStartedEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
    GraphRunSucceededEvent,
)

test_case = WorkflowTestCase(
    fixture_path="workflow",
    inputs={},
    expected_outputs={},
    expected_event_sequence=[
        GraphRunStartedEvent,
        NodeRunStartedEvent,
        NodeRunSucceededEvent,
        GraphRunSucceededEvent,
    ]
)
```

### Test Suite Reports

```python
# Run test suite
suite_result = runner.run_table_tests(test_cases)

# Generate detailed report
report = runner.generate_report(suite_result)
print(report)

# Access specific results
failed_results = suite_result.get_failed_results()
for result in failed_results:
    print(f"Failed: {result.test_case.description}")
    print(f"  Error: {result.error}")
```

### Performance Testing

```python
# Enable logging for performance insights
runner = TableTestRunner(
    enable_logging=True,
    log_level="DEBUG"
)

# Run tests and analyze performance
suite_result = runner.run_table_tests(test_cases)

# Get slowest tests
sorted_results = sorted(
    suite_result.results,
    key=lambda r: r.execution_time,
    reverse=True
)

print("Slowest tests:")
for result in sorted_results[:5]:
    print(f"  {result.test_case.description}: {result.execution_time:.2f}s")
```

## Integration: TableTestRunner + Auto-Mock System

The TableTestRunner seamlessly integrates with the auto-mock system for comprehensive workflow testing:

```python
from test_table_runner import TableTestRunner, WorkflowTestCase
from test_mock_config import MockConfigBuilder

# Configure mocks
mock_config = (MockConfigBuilder()
    .with_llm_response("Mocked LLM response")
    .with_tool_response({"result": "mocked"})
    .with_delays(True)  # Simulate realistic delays
    .build())

# Create test case with mocking
test_case = WorkflowTestCase(
    fixture_path="complex_workflow",
    inputs={"query": "test"},
    expected_outputs={"answer": "Mocked LLM response"},
    use_auto_mock=True,  # Enable auto-mocking
    mock_config=mock_config,
    description="Test with mocked services",
)

# Run test
runner = TableTestRunner()
result = runner.run_test_case(test_case)
```

## Auto-Mock System

The auto-mock system provides a powerful framework for testing workflows that contain nodes requiring third-party services (LLM, APIs, tools, etc.) without making actual external calls. This enables:

- **Fast test execution** - No network latency or API rate limits
- **Deterministic results** - Consistent outputs for reliable testing
- **Cost savings** - No API usage charges during testing
- **Offline testing** - Tests can run without internet connectivity
- **Error simulation** - Test error handling without triggering real failures

## Architecture

The auto-mock system consists of three main components:

### 1. MockNodeFactory (`test_mock_factory.py`)

- Extends `DifyNodeFactory` to intercept node creation
- Automatically detects nodes requiring third-party services
- Returns mock node implementations instead of real ones
- Supports registration of custom mock implementations

### 2. Mock Node Implementations (`test_mock_nodes.py`)

- `MockLLMNode` - Mocks LLM API calls (OpenAI, Anthropic, etc.)
- `MockAgentNode` - Mocks agent execution
- `MockToolNode` - Mocks tool invocations
- `MockKnowledgeRetrievalNode` - Mocks knowledge base queries
- `MockHttpRequestNode` - Mocks HTTP requests
- `MockParameterExtractorNode` - Mocks parameter extraction
- `MockDocumentExtractorNode` - Mocks document processing
- `MockQuestionClassifierNode` - Mocks question classification

### 3. Mock Configuration (`test_mock_config.py`)

- `MockConfig` - Global configuration for mock behavior
- `NodeMockConfig` - Node-specific mock configuration
- `MockConfigBuilder` - Fluent interface for building configurations

## Usage

### Basic Example

```python
from test_graph_engine import TableTestRunner, WorkflowTestCase
from test_mock_config import MockConfigBuilder

# Create test runner
runner = TableTestRunner()

# Configure mock responses
mock_config = (MockConfigBuilder()
               .with_llm_response("Mocked LLM response")
               .build())

# Define test case
test_case = WorkflowTestCase(
    fixture_path="llm-simple",
    inputs={"query": "Hello"},
    expected_outputs={"answer": "Mocked LLM response"},
    use_auto_mock=True,  # Enable auto-mocking
    mock_config=mock_config,
)

# Run test
result = runner.run_test_case(test_case)
assert result.success
```

### Custom Node Outputs

```python
# Configure specific outputs for individual nodes
mock_config = MockConfig()
mock_config.set_node_outputs("llm_node_123", {
    "text": "Custom response for this specific node",
    "usage": {"total_tokens": 50},
    "finish_reason": "stop",
})
```

### Error Simulation

```python
# Simulate node failures for error handling tests
mock_config = MockConfig()
mock_config.set_node_error("http_node", "Connection timeout")
```

### Simulated Delays

```python
# Add realistic execution delays
from test_mock_config import NodeMockConfig

node_config = NodeMockConfig(
    node_id="llm_node",
    outputs={"text": "Response"},
    delay=1.5,  # 1.5 second delay
)
mock_config.set_node_config("llm_node", node_config)
```

### Custom Handlers

```python
# Define custom logic for mock outputs
def custom_handler(node):
    # Access node state and return dynamic outputs
    return {
        "text": f"Processed: {node.graph_runtime_state.variable_pool.get('query')}",
    }

node_config = NodeMockConfig(
    node_id="llm_node",
    custom_handler=custom_handler,
)
```

## Node Types Automatically Mocked

The following node types are automatically mocked when `use_auto_mock=True`:

- `LLM` - Language model nodes
- `AGENT` - Agent execution nodes
- `TOOL` - Tool invocation nodes
- `KNOWLEDGE_RETRIEVAL` - Knowledge base query nodes
- `HTTP_REQUEST` - HTTP request nodes
- `PARAMETER_EXTRACTOR` - Parameter extraction nodes
- `DOCUMENT_EXTRACTOR` - Document processing nodes
- `QUESTION_CLASSIFIER` - Question classification nodes

## Advanced Features

### Registering Custom Mock Implementations

```python
from test_mock_factory import MockNodeFactory

# Create custom mock implementation
class CustomMockNode(BaseNode):
    def _run(self):
        # Custom mock logic
        pass

# Register for a specific node type
factory = MockNodeFactory(...)
factory.register_mock_node_type(NodeType.CUSTOM, CustomMockNode)
```

### Default Configurations by Node Type

```python
# Set defaults for all nodes of a specific type
mock_config.set_default_config(NodeType.LLM, {
    "temperature": 0.7,
    "max_tokens": 100,
})
```

### MockConfigBuilder Fluent API

```python
config = (MockConfigBuilder()
    .with_llm_response("LLM response")
    .with_agent_response("Agent response")
    .with_tool_response({"result": "data"})
    .with_retrieval_response("Retrieved content")
    .with_http_response({"status_code": 200, "body": "{}"})
    .with_node_output("node_id", {"output": "value"})
    .with_node_error("error_node", "Error message")
    .with_delays(True)
    .build())
```

## Testing Workflows

### 1. Create Workflow Fixture

Create a YAML fixture file in `api/tests/fixtures/workflow/` directory defining your workflow graph.

### 2. Configure Mocks

Set up mock configurations for nodes that need third-party services.

### 3. Define Test Cases

Create `WorkflowTestCase` instances with inputs, expected outputs, and mock config.

### 4. Run Tests

Use `TableTestRunner` to execute test cases and validate results.

## Best Practices

1. **Use descriptive mock responses** - Make it clear in outputs that they are mocked
1. **Test both success and failure paths** - Use error simulation to test error handling
1. **Keep mock configs close to tests** - Define mocks in the same test file for clarity
1. **Use custom handlers sparingly** - Only when dynamic behavior is needed
1. **Document mock behavior** - Comment why specific mock values are chosen
1. **Validate mock accuracy** - Ensure mocks reflect real service behavior

## Examples

See `test_mock_example.py` for comprehensive examples including:

- Basic LLM workflow testing
- Custom node outputs
- HTTP and tool workflow testing
- Error simulation
- Performance testing with delays

## Running Tests

### TableTestRunner Tests

```bash
# Run graph engine tests (includes property-based tests)
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/test_graph_engine.py

# Run with specific test patterns
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/test_graph_engine.py -k "test_echo"

# Run with verbose output
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/test_graph_engine.py -v
```

### Mock System Tests

```bash
# Run auto-mock system tests
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/test_auto_mock_system.py

# Run examples
uv run python api/tests/unit_tests/core/workflow/graph_engine/test_mock_example.py

# Run simple validation
uv run python api/tests/unit_tests/core/workflow/graph_engine/test_mock_simple.py
```

### All Tests

```bash
# Run all graph engine tests
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/

# Run with coverage
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/ --cov=core.workflow.graph_engine

# Run in parallel
uv run pytest api/tests/unit_tests/core/workflow/graph_engine/ -n auto
```

## Troubleshooting

### Issue: Mock not being applied

- Ensure `use_auto_mock=True` in `WorkflowTestCase`
- Verify node ID matches in mock config
- Check that node type is in the auto-mock list

### Issue: Unexpected outputs

- Debug by printing `result.actual_outputs`
- Check if custom handler is overriding expected outputs
- Verify mock config is properly built

### Issue: Import errors

- Ensure all mock modules are in the correct path
- Check that required dependencies are installed

## Future Enhancements

Potential improvements to the auto-mock system:

1. **Recording and playback** - Record real API responses for replay in tests
1. **Mock templates** - Pre-defined mock configurations for common scenarios
1. **Async support** - Better support for async node execution
1. **Mock validation** - Validate mock outputs against node schemas
1. **Performance profiling** - Built-in performance metrics for mocked workflows

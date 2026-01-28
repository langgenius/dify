"""
Table-driven test framework for GraphEngine workflows.

This file contains property-based tests and specific workflow tests.
The core test framework is in test_table_runner.py.
"""

import time

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from core.workflow.enums import ErrorStrategy
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunPartialSucceededEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.nodes.base.entities import DefaultValue, DefaultValueType

# Import the test framework from the new module
from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowRunner, WorkflowTestCase


# Property-based fuzzing tests for the start-end workflow
@given(query_input=st.text())
@settings(max_examples=50, deadline=30000, suppress_health_check=[HealthCheck.too_slow])
def test_echo_workflow_property_basic_strings(query_input):
    """
    Property-based test: Echo workflow should return exactly what was input.

    This tests the fundamental property that for any string input,
    the start-end workflow should echo it back unchanged.
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": query_input},
        expected_outputs={"query": query_input},
        description=f"Fuzzing test with input: {repr(query_input)[:50]}...",
    )

    result = runner.run_test_case(test_case)

    # Property: The workflow should complete successfully
    assert result.success, f"Workflow failed with input {repr(query_input)}: {result.error}"

    # Property: Output should equal input (echo behavior)
    assert result.actual_outputs
    assert result.actual_outputs == {"query": query_input}, (
        f"Echo property violated. Input: {repr(query_input)}, "
        f"Expected: {repr(query_input)}, Got: {repr(result.actual_outputs.get('query'))}"
    )


@given(query_input=st.text(min_size=0, max_size=1000))
@settings(max_examples=30, deadline=20000)
def test_echo_workflow_property_bounded_strings(query_input):
    """
    Property-based test with size bounds to test edge cases more efficiently.

    Tests strings up to 1000 characters to balance thoroughness with performance.
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": query_input},
        expected_outputs={"query": query_input},
        description=f"Bounded fuzzing test (len={len(query_input)})",
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed with bounded input: {result.error}"
    assert result.actual_outputs == {"query": query_input}


@given(
    query_input=st.one_of(
        st.text(alphabet=st.characters(whitelist_categories=["Lu", "Ll", "Nd", "Po"])),  # Letters, digits, punctuation
        st.text(alphabet="🎉🌟💫⭐🔥💯🚀🎯"),  # Emojis
        st.text(alphabet="αβγδεζηθικλμνξοπρστυφχψω"),  # Greek letters
        st.text(alphabet="中文测试한국어日本語العربية"),  # International characters
        st.just(""),  # Empty string
        st.just(" " * 100),  # Whitespace only
        st.just("\n\t\r\f\v"),  # Special whitespace chars
        st.just('{"json": "like", "data": [1, 2, 3]}'),  # JSON-like string
        st.just("SELECT * FROM users; DROP TABLE users;--"),  # SQL injection attempt
        st.just("<script>alert('xss')</script>"),  # XSS attempt
        st.just("../../etc/passwd"),  # Path traversal attempt
    )
)
@settings(max_examples=40, deadline=25000)
def test_echo_workflow_property_diverse_inputs(query_input):
    """
    Property-based test with diverse input types including edge cases and security payloads.

    Tests various categories of potentially problematic inputs:
    - Unicode characters from different languages
    - Emojis and special symbols
    - Whitespace variations
    - Malicious payloads (SQL injection, XSS, path traversal)
    - JSON-like structures
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": query_input},
        expected_outputs={"query": query_input},
        description=f"Diverse input fuzzing: {type(query_input).__name__}",
    )

    result = runner.run_test_case(test_case)

    # Property: System should handle all inputs gracefully (no crashes)
    assert result.success, f"Workflow failed with diverse input {repr(query_input)}: {result.error}"

    # Property: Echo behavior must be preserved regardless of input type
    assert result.actual_outputs == {"query": query_input}


@given(query_input=st.text(min_size=1000, max_size=5000))
@settings(max_examples=10, deadline=60000)
def test_echo_workflow_property_large_inputs(query_input):
    """
    Property-based test for large inputs to test memory and performance boundaries.

    Tests the system's ability to handle larger payloads efficiently.
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": query_input},
        expected_outputs={"query": query_input},
        description=f"Large input test (size: {len(query_input)} chars)",
        timeout=45.0,  # Longer timeout for large inputs
    )

    start_time = time.perf_counter()
    result = runner.run_test_case(test_case)
    execution_time = time.perf_counter() - start_time

    # Property: Large inputs should still work
    assert result.success, f"Large input workflow failed: {result.error}"

    # Property: Echo behavior preserved for large inputs
    assert result.actual_outputs == {"query": query_input}

    # Property: Performance should be reasonable even for large inputs
    assert execution_time < 30.0, f"Large input took too long: {execution_time:.2f}s"


def test_echo_workflow_robustness_smoke_test():
    """
    Smoke test to ensure the basic workflow functionality works before fuzzing.

    This test uses a simple, known-good input to verify the test infrastructure
    is working correctly before running the fuzzing tests.
    """
    runner = TableTestRunner()

    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "smoke test"},
        expected_outputs={"query": "smoke test"},
        description="Smoke test for basic functionality",
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Smoke test failed: {result.error}"
    assert result.actual_outputs == {"query": "smoke test"}
    assert result.execution_time > 0


def test_if_else_workflow_true_branch():
    """
    Test if-else workflow when input contains 'hello' (true branch).

    Should output {"true": input_query} when query contains "hello".
    """
    runner = TableTestRunner()

    test_cases = [
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hello world"},
            expected_outputs={"true": "hello world"},
            description="Basic hello case",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "say hello to everyone"},
            expected_outputs={"true": "say hello to everyone"},
            description="Hello in middle of sentence",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hello"},
            expected_outputs={"true": "hello"},
            description="Just hello",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hellohello"},
            expected_outputs={"true": "hellohello"},
            description="Multiple hello occurrences",
        ),
    ]

    suite_result = runner.run_table_tests(test_cases)

    for result in suite_result.results:
        assert result.success, f"Test case '{result.test_case.description}' failed: {result.error}"
        # Check that outputs contain ONLY the expected key (true branch)
        assert result.actual_outputs == result.test_case.expected_outputs, (
            f"Expected only 'true' key in outputs for {result.test_case.description}. "
            f"Expected: {result.test_case.expected_outputs}, Got: {result.actual_outputs}"
        )


def test_if_else_workflow_false_branch():
    """
    Test if-else workflow when input does not contain 'hello' (false branch).

    Should output {"false": input_query} when query does not contain "hello".
    """
    runner = TableTestRunner()

    test_cases = [
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "goodbye world"},
            expected_outputs={"false": "goodbye world"},
            description="Basic goodbye case",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hi there"},
            expected_outputs={"false": "hi there"},
            description="Simple greeting without hello",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": ""},
            expected_outputs={"false": ""},
            description="Empty string",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "test message"},
            expected_outputs={"false": "test message"},
            description="Regular message",
        ),
    ]

    suite_result = runner.run_table_tests(test_cases)

    for result in suite_result.results:
        assert result.success, f"Test case '{result.test_case.description}' failed: {result.error}"
        # Check that outputs contain ONLY the expected key (false branch)
        assert result.actual_outputs == result.test_case.expected_outputs, (
            f"Expected only 'false' key in outputs for {result.test_case.description}. "
            f"Expected: {result.test_case.expected_outputs}, Got: {result.actual_outputs}"
        )


def test_if_else_workflow_edge_cases():
    """
    Test if-else workflow edge cases and case sensitivity.

    Tests various edge cases including case sensitivity, similar words, etc.
    """
    runner = TableTestRunner()

    test_cases = [
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "Hello world"},
            expected_outputs={"false": "Hello world"},
            description="Capitalized Hello (case sensitive test)",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "HELLO"},
            expected_outputs={"false": "HELLO"},
            description="All caps HELLO (case sensitive test)",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "helllo"},
            expected_outputs={"false": "helllo"},
            description="Typo: helllo (with extra l)",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "helo"},
            expected_outputs={"false": "helo"},
            description="Typo: helo (missing l)",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hello123"},
            expected_outputs={"true": "hello123"},
            description="Hello with numbers",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": "hello!@#"},
            expected_outputs={"true": "hello!@#"},
            description="Hello with special characters",
        ),
        WorkflowTestCase(
            fixture_path="conditional_hello_branching_workflow",
            inputs={"query": " hello "},
            expected_outputs={"true": " hello "},
            description="Hello with surrounding spaces",
        ),
    ]

    suite_result = runner.run_table_tests(test_cases)

    for result in suite_result.results:
        assert result.success, f"Test case '{result.test_case.description}' failed: {result.error}"
        # Check that outputs contain ONLY the expected key
        assert result.actual_outputs == result.test_case.expected_outputs, (
            f"Expected exact match for {result.test_case.description}. "
            f"Expected: {result.test_case.expected_outputs}, Got: {result.actual_outputs}"
        )


@given(query_input=st.text())
@settings(max_examples=50, deadline=30000, suppress_health_check=[HealthCheck.too_slow])
def test_if_else_workflow_property_basic_strings(query_input):
    """
    Property-based test: If-else workflow should output correct branch based on 'hello' content.

    This tests the fundamental property that for any string input:
    - If input contains "hello", output should be {"true": input}
    - If input doesn't contain "hello", output should be {"false": input}
    """
    runner = TableTestRunner()

    # Determine expected output based on whether input contains "hello"
    contains_hello = "hello" in query_input
    expected_key = "true" if contains_hello else "false"
    expected_outputs = {expected_key: query_input}

    test_case = WorkflowTestCase(
        fixture_path="conditional_hello_branching_workflow",
        inputs={"query": query_input},
        expected_outputs=expected_outputs,
        description=f"Property test with input: {repr(query_input)[:50]}...",
    )

    result = runner.run_test_case(test_case)

    # Property: The workflow should complete successfully
    assert result.success, f"Workflow failed with input {repr(query_input)}: {result.error}"

    # Property: Output should contain ONLY the expected key with correct value
    assert result.actual_outputs == expected_outputs, (
        f"If-else property violated. Input: {repr(query_input)}, "
        f"Expected: {expected_outputs}, Got: {result.actual_outputs}"
    )


@given(query_input=st.text(min_size=0, max_size=1000))
@settings(max_examples=30, deadline=20000)
def test_if_else_workflow_property_bounded_strings(query_input):
    """
    Property-based test with size bounds for if-else workflow.

    Tests strings up to 1000 characters to balance thoroughness with performance.
    """
    runner = TableTestRunner()

    contains_hello = "hello" in query_input
    expected_key = "true" if contains_hello else "false"
    expected_outputs = {expected_key: query_input}

    test_case = WorkflowTestCase(
        fixture_path="conditional_hello_branching_workflow",
        inputs={"query": query_input},
        expected_outputs=expected_outputs,
        description=f"Bounded if-else test (len={len(query_input)}, contains_hello={contains_hello})",
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed with bounded input: {result.error}"
    assert result.actual_outputs == expected_outputs


@given(
    query_input=st.one_of(
        st.text(alphabet=st.characters(whitelist_categories=["Lu", "Ll", "Nd", "Po"])),  # Letters, digits, punctuation
        st.text(alphabet="hello"),  # Strings that definitely contain hello
        st.text(alphabet="xyz"),  # Strings that definitely don't contain hello
        st.just("hello world"),  # Known true case
        st.just("goodbye world"),  # Known false case
        st.just(""),  # Empty string
        st.just("Hello"),  # Case sensitivity test
        st.just("HELLO"),  # Case sensitivity test
        st.just("hello" * 10),  # Multiple hello occurrences
        st.just("say hello to everyone"),  # Hello in middle
        st.text(alphabet="🎉🌟💫⭐🔥💯🚀🎯"),  # Emojis
        st.text(alphabet="中文测试한국어日本語العربية"),  # International characters
    )
)
@settings(max_examples=40, deadline=25000)
def test_if_else_workflow_property_diverse_inputs(query_input):
    """
    Property-based test with diverse input types for if-else workflow.

    Tests various categories including:
    - Known true/false cases
    - Case sensitivity scenarios
    - Unicode characters from different languages
    - Emojis and special symbols
    - Multiple hello occurrences
    """
    runner = TableTestRunner()

    contains_hello = "hello" in query_input
    expected_key = "true" if contains_hello else "false"
    expected_outputs = {expected_key: query_input}

    test_case = WorkflowTestCase(
        fixture_path="conditional_hello_branching_workflow",
        inputs={"query": query_input},
        expected_outputs=expected_outputs,
        description=f"Diverse if-else test: {type(query_input).__name__} (contains_hello={contains_hello})",
    )

    result = runner.run_test_case(test_case)

    # Property: System should handle all inputs gracefully (no crashes)
    assert result.success, f"Workflow failed with diverse input {repr(query_input)}: {result.error}"

    # Property: Correct branch logic must be preserved regardless of input type
    assert result.actual_outputs == expected_outputs, (
        f"Branch logic violated. Input: {repr(query_input)}, "
        f"Contains 'hello': {contains_hello}, Expected: {expected_outputs}, Got: {result.actual_outputs}"
    )


# Tests for the Layer system
def test_layer_system_basic():
    """Test basic layer functionality with DebugLoggingLayer."""
    from core.workflow.graph_engine.layers import DebugLoggingLayer

    runner = WorkflowRunner()

    # Load a simple echo workflow
    fixture_data = runner.load_fixture("simple_passthrough_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(fixture_data, inputs={"query": "test layer system"})

    # Create engine with layer
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    # Add debug logging layer
    debug_layer = DebugLoggingLayer(level="DEBUG", include_inputs=True, include_outputs=True)
    engine.layer(debug_layer)

    # Run workflow
    events = list(engine.run())

    # Verify events were generated
    assert len(events) > 0
    assert isinstance(events[0], GraphRunStartedEvent)
    assert isinstance(events[-1], GraphRunSucceededEvent)

    # Verify layer received context
    assert debug_layer.graph_runtime_state is not None
    assert debug_layer.command_channel is not None

    # Verify layer tracked execution stats
    assert debug_layer.node_count > 0
    assert debug_layer.success_count > 0


def test_layer_chaining():
    """Test chaining multiple layers."""
    from core.workflow.graph_engine.layers import DebugLoggingLayer, GraphEngineLayer

    # Create a custom test layer
    class TestLayer(GraphEngineLayer):
        def __init__(self):
            super().__init__()
            self.events_received = []
            self.graph_started = False
            self.graph_ended = False

        def on_graph_start(self):
            self.graph_started = True

        def on_event(self, event):
            self.events_received.append(event.__class__.__name__)

        def on_graph_end(self, error):
            self.graph_ended = True

    runner = WorkflowRunner()

    # Load workflow
    fixture_data = runner.load_fixture("simple_passthrough_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(fixture_data, inputs={"query": "test chaining"})

    # Create engine
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    # Chain multiple layers
    test_layer = TestLayer()
    debug_layer = DebugLoggingLayer(level="INFO")

    engine.layer(test_layer).layer(debug_layer)

    # Run workflow
    events = list(engine.run())

    # Verify both layers received events
    assert test_layer.graph_started
    assert test_layer.graph_ended
    assert len(test_layer.events_received) > 0

    # Verify debug layer also worked
    assert debug_layer.node_count > 0


def test_layer_error_handling():
    """Test that layer errors don't crash the engine."""
    from core.workflow.graph_engine.layers import GraphEngineLayer

    # Create a layer that throws errors
    class FaultyLayer(GraphEngineLayer):
        def on_graph_start(self):
            raise RuntimeError("Intentional error in on_graph_start")

        def on_event(self, event):
            raise RuntimeError("Intentional error in on_event")

        def on_graph_end(self, error):
            raise RuntimeError("Intentional error in on_graph_end")

    runner = WorkflowRunner()

    # Load workflow
    fixture_data = runner.load_fixture("simple_passthrough_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(fixture_data, inputs={"query": "test error handling"})

    # Create engine with faulty layer
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    # Add faulty layer
    engine.layer(FaultyLayer())

    # Run workflow - should not crash despite layer errors
    events = list(engine.run())

    # Verify workflow still completed successfully
    assert len(events) > 0
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert events[-1].outputs == {"query": "test error handling"}


def test_event_sequence_validation():
    """Test the new event sequence validation feature."""
    from core.workflow.graph_events import NodeRunStartedEvent, NodeRunStreamChunkEvent, NodeRunSucceededEvent

    runner = TableTestRunner()

    # Test 1: Successful event sequence validation
    test_case_success = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "test event sequence"},
        expected_outputs={"query": "test event sequence"},
        expected_event_sequence=[
            GraphRunStartedEvent,
            NodeRunStartedEvent,  # Start node begins
            NodeRunStreamChunkEvent,  # Start node streaming
            NodeRunSucceededEvent,  # Start node completes
            NodeRunStartedEvent,  # End node begins
            NodeRunSucceededEvent,  # End node completes
            GraphRunSucceededEvent,  # Graph completes
        ],
        description="Test with correct event sequence",
    )

    result = runner.run_test_case(test_case_success)
    assert result.success, f"Test should pass with correct event sequence. Error: {result.event_mismatch_details}"
    assert result.event_sequence_match is True
    assert result.event_mismatch_details is None

    # Test 2: Failed event sequence validation - wrong order
    test_case_wrong_order = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "test wrong order"},
        expected_outputs={"query": "test wrong order"},
        expected_event_sequence=[
            GraphRunStartedEvent,
            NodeRunSucceededEvent,  # Wrong: expecting success before start
            NodeRunStreamChunkEvent,
            NodeRunStartedEvent,
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            GraphRunSucceededEvent,
        ],
        description="Test with incorrect event order",
    )

    result = runner.run_test_case(test_case_wrong_order)
    assert not result.success, "Test should fail with incorrect event sequence"
    assert result.event_sequence_match is False
    assert result.event_mismatch_details is not None
    assert "Event mismatch at position" in result.event_mismatch_details

    # Test 3: Failed event sequence validation - wrong count
    test_case_wrong_count = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "test wrong count"},
        expected_outputs={"query": "test wrong count"},
        expected_event_sequence=[
            GraphRunStartedEvent,
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Missing the second node's events
            GraphRunSucceededEvent,
        ],
        description="Test with incorrect event count",
    )

    result = runner.run_test_case(test_case_wrong_count)
    assert not result.success, "Test should fail with incorrect event count"
    assert result.event_sequence_match is False
    assert result.event_mismatch_details is not None
    assert "Event count mismatch" in result.event_mismatch_details

    # Test 4: No event sequence validation (backward compatibility)
    test_case_no_validation = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "test no validation"},
        expected_outputs={"query": "test no validation"},
        # No expected_event_sequence provided
        description="Test without event sequence validation",
    )

    result = runner.run_test_case(test_case_no_validation)
    assert result.success, "Test should pass when no event sequence is provided"
    assert result.event_sequence_match is None
    assert result.event_mismatch_details is None


def test_event_sequence_validation_with_table_tests():
    """Test event sequence validation with table-driven tests."""
    from core.workflow.graph_events import NodeRunStartedEvent, NodeRunStreamChunkEvent, NodeRunSucceededEvent

    runner = TableTestRunner()

    test_cases = [
        WorkflowTestCase(
            fixture_path="simple_passthrough_workflow",
            inputs={"query": "test1"},
            expected_outputs={"query": "test1"},
            expected_event_sequence=[
                GraphRunStartedEvent,
                NodeRunStartedEvent,
                NodeRunStreamChunkEvent,
                NodeRunSucceededEvent,
                NodeRunStartedEvent,
                NodeRunSucceededEvent,
                GraphRunSucceededEvent,
            ],
            description="Table test 1: Valid sequence",
        ),
        WorkflowTestCase(
            fixture_path="simple_passthrough_workflow",
            inputs={"query": "test2"},
            expected_outputs={"query": "test2"},
            # No event sequence validation for this test
            description="Table test 2: No sequence validation",
        ),
        WorkflowTestCase(
            fixture_path="simple_passthrough_workflow",
            inputs={"query": "test3"},
            expected_outputs={"query": "test3"},
            expected_event_sequence=[
                GraphRunStartedEvent,
                NodeRunStartedEvent,
                NodeRunStreamChunkEvent,
                NodeRunSucceededEvent,
                NodeRunStartedEvent,
                NodeRunSucceededEvent,
                GraphRunSucceededEvent,
            ],
            description="Table test 3: Valid sequence",
        ),
    ]

    suite_result = runner.run_table_tests(test_cases)

    # Check all tests passed
    for i, result in enumerate(suite_result.results):
        if i == 1:  # Test 2 has no event sequence validation
            assert result.event_sequence_match is None
        else:
            assert result.event_sequence_match is True
        assert result.success, f"Test {i + 1} failed: {result.event_mismatch_details or result.error}"


def test_graph_run_emits_partial_success_when_node_failure_recovered():
    runner = TableTestRunner()

    fixture_data = runner.workflow_runner.load_fixture("basic_chatflow")
    mock_config = MockConfigBuilder().with_node_error("llm", "mock llm failure").build()

    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="hello",
        use_mock_factory=True,
        mock_config=mock_config,
    )

    llm_node = graph.nodes["llm"]
    base_node_data = llm_node.node_data
    base_node_data.error_strategy = ErrorStrategy.DEFAULT_VALUE
    base_node_data.default_value = [DefaultValue(key="text", value="fallback response", type=DefaultValueType.STRING)]

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    events = list(engine.run())

    assert isinstance(events[-1], GraphRunPartialSucceededEvent)

    partial_event = next(event for event in events if isinstance(event, GraphRunPartialSucceededEvent))
    assert partial_event.exceptions_count == 1
    assert partial_event.outputs.get("answer") == "fallback response"

    assert not any(isinstance(event, GraphRunSucceededEvent) for event in events)

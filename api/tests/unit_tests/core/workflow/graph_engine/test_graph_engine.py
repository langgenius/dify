"""
Table-driven test framework for GraphEngine workflows.

This framework provides table-driven testing with parallel execution support
for testing workflows through the GraphEngine.
"""

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import GraphRunStartedEvent, GraphRunSucceededEvent
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


@dataclass
class WorkflowTestCase:
    """Represents a single test case for table testing."""

    fixture_path: str
    inputs: dict[str, Any]
    expected_outputs: dict[str, Any]
    description: str = ""
    timeout: float = 30.0


@dataclass
class WorkflowTestResult:
    """Result of executing a single test case."""

    test_case: WorkflowTestCase
    success: bool
    error: Optional[Exception] = None
    actual_outputs: Optional[dict[str, Any]] = None
    execution_time: float = 0.0


class WorkflowRunner:
    """Helper class for loading and executing workflow fixtures."""

    def __init__(self, fixtures_dir: Optional[Path] = None):
        """Initialize the workflow runner."""
        if fixtures_dir is None:
            # Default to the fixtures directory relative to this test file
            test_dir = Path(__file__).parent
            fixtures_dir = test_dir / "fixtures"

        self.fixtures_dir = Path(fixtures_dir)
        if not self.fixtures_dir.exists():
            raise ValueError(f"Fixtures directory does not exist: {self.fixtures_dir}")

    def load_fixture(self, fixture_name: str) -> dict[str, Any]:
        """Load a YAML fixture file."""
        if not fixture_name.endswith(".yml") and not fixture_name.endswith(".yaml"):
            fixture_name = f"{fixture_name}.yml"

        fixture_path = self.fixtures_dir / fixture_name
        if not fixture_path.exists():
            raise FileNotFoundError(f"Fixture file not found: {fixture_path}")

        with open(fixture_path, encoding="utf-8") as f:
            return yaml.safe_load(f)

    def create_graph_from_fixture(
        self, fixture_data: dict[str, Any], custom_inputs: Optional[dict[str, Any]] = None
    ) -> tuple[Graph, GraphRuntimeState]:
        """Create a Graph instance from fixture data."""
        # Extract the workflow graph configuration
        workflow_config = fixture_data.get("workflow", {})
        graph_config = workflow_config.get("graph", {})

        if not graph_config:
            raise ValueError("Fixture missing workflow.graph configuration")

        # Extract workflow type (default to WORKFLOW)
        app_config = fixture_data.get("app", {})
        mode = app_config.get("mode", "workflow")

        # Create graph initialization parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config=graph_config,
            user_id="test_user",
            user_from="account",
            invoke_from="web-app",
            call_depth=0,
        )

        # Create variable pool with system variables and custom inputs
        system_variables = SystemVariable(
            user_id=graph_init_params.user_id,
            app_id=graph_init_params.app_id,
            workflow_id=graph_init_params.workflow_id,
            files=[],
        )
        user_inputs = custom_inputs if custom_inputs is not None else {}
        variable_pool = VariablePool(
            system_variables=system_variables,
            user_inputs=user_inputs,
        )

        # Create graph runtime state
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        # Create node factory
        node_factory = DifyNodeFactory(graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state)

        # Create the graph
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

        # Return both the graph and the graph runtime state
        return graph, graph_runtime_state


class TableTestRunner:
    """
    Table-based test runner for executing multiple workflow test cases.

    Supports parallel execution of test cases defined in a table format.
    """

    def __init__(self, fixtures_dir: Optional[Path] = None, max_workers: int = 4):
        """Initialize the table test runner."""
        self.workflow_runner = WorkflowRunner(fixtures_dir)
        self.max_workers = max_workers

    def run_test_case(self, test_case: WorkflowTestCase) -> WorkflowTestResult:
        """Execute a single test case."""
        start_time = time.perf_counter()

        try:
            # Load fixture data
            fixture_data = self.workflow_runner.load_fixture(test_case.fixture_path)

            # Create graph from fixture
            graph, graph_runtime_state = self.workflow_runner.create_graph_from_fixture(fixture_data, test_case.inputs)

            # Get graph config for engine
            workflow_config = fixture_data.get("workflow", {})
            graph_config = workflow_config.get("graph", {})

            # Create and run the engine
            engine = GraphEngine(
                tenant_id="test_tenant",
                app_id="test_app",
                workflow_id="test_workflow",
                user_id="test_user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.WEB_APP,
                call_depth=0,
                graph=graph,
                graph_config=graph_config,
                graph_runtime_state=graph_runtime_state,
                max_execution_steps=500,
                max_execution_time=int(test_case.timeout),
                command_channel=InMemoryChannel(),
            )

            # Execute and collect events
            events = []
            for event in engine.run():
                events.append(event)

            # Check execution success
            has_start = any(isinstance(e, GraphRunStartedEvent) for e in events)
            success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
            has_success = len(success_events) > 0

            if not (has_start and has_success):
                return WorkflowTestResult(
                    test_case=test_case,
                    success=False,
                    error=Exception("Workflow did not complete successfully"),
                    execution_time=time.perf_counter() - start_time,
                )

            # Get actual outputs
            success_event = success_events[-1]
            actual_outputs = success_event.outputs or {}

            # Validate outputs
            success = self._validate_outputs(test_case.expected_outputs, actual_outputs)

            return WorkflowTestResult(
                test_case=test_case,
                success=success,
                actual_outputs=actual_outputs,
                execution_time=time.perf_counter() - start_time,
            )

        except Exception as e:
            return WorkflowTestResult(
                test_case=test_case,
                success=False,
                error=e,
                execution_time=time.perf_counter() - start_time,
            )

    def _validate_outputs(self, expected_outputs: dict[str, Any], actual_outputs: dict[str, Any]) -> bool:
        """Validate actual outputs against expected outputs."""
        for key, expected_value in expected_outputs.items():
            if key not in actual_outputs:
                return False

            actual_value = actual_outputs[key]
            if actual_value != expected_value:
                return False

        return True

    def run_table_tests(self, test_cases: list[WorkflowTestCase]) -> list[WorkflowTestResult]:
        """Run multiple test cases as a table test."""
        return [self.run_test_case(test_case) for test_case in test_cases]


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
        fixture_path="echo",
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
        fixture_path="echo",
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
        fixture_path="echo",
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
        fixture_path="echo",
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
        fixture_path="echo",
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
            fixture_path="if-else",
            inputs={"query": "hello world"},
            expected_outputs={"true": "hello world"},
            description="Basic hello case",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "say hello to everyone"},
            expected_outputs={"true": "say hello to everyone"},
            description="Hello in middle of sentence",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "hello"},
            expected_outputs={"true": "hello"},
            description="Just hello",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "hellohello"},
            expected_outputs={"true": "hellohello"},
            description="Multiple hello occurrences",
        ),
    ]

    results = runner.run_table_tests(test_cases)

    for result in results:
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
            fixture_path="if-else",
            inputs={"query": "goodbye world"},
            expected_outputs={"false": "goodbye world"},
            description="Basic goodbye case",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "hi there"},
            expected_outputs={"false": "hi there"},
            description="Simple greeting without hello",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": ""},
            expected_outputs={"false": ""},
            description="Empty string",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "test message"},
            expected_outputs={"false": "test message"},
            description="Regular message",
        ),
    ]

    results = runner.run_table_tests(test_cases)

    for result in results:
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
            fixture_path="if-else",
            inputs={"query": "Hello world"},
            expected_outputs={"false": "Hello world"},
            description="Capitalized Hello (case sensitive test)",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "HELLO"},
            expected_outputs={"false": "HELLO"},
            description="All caps HELLO (case sensitive test)",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "helllo"},
            expected_outputs={"false": "helllo"},
            description="Typo: helllo (with extra l)",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "helo"},
            expected_outputs={"false": "helo"},
            description="Typo: helo (missing l)",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "hello123"},
            expected_outputs={"true": "hello123"},
            description="Hello with numbers",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": "hello!@#"},
            expected_outputs={"true": "hello!@#"},
            description="Hello with special characters",
        ),
        WorkflowTestCase(
            fixture_path="if-else",
            inputs={"query": " hello "},
            expected_outputs={"true": " hello "},
            description="Hello with surrounding spaces",
        ),
    ]

    results = runner.run_table_tests(test_cases)

    for result in results:
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
        fixture_path="if-else",
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
        fixture_path="if-else",
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
        fixture_path="if-else",
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

"""
Table-driven test framework for GraphEngine workflows.

This module provides a robust table-driven testing framework with support for:
- Parallel test execution
- Property-based testing with Hypothesis
- Event sequence validation
- Mock configuration
- Performance metrics
- Detailed error reporting
"""

import logging
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.app.workflow.node_factory import DifyNodeFactory
from core.tools.utils.yaml_utils import _load_yaml_file
from core.variables import (
    ArrayNumberVariable,
    ArrayObjectVariable,
    ArrayStringVariable,
    FloatVariable,
    IntegerVariable,
    ObjectVariable,
    StringVariable,
)
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable

from .test_mock_config import MockConfig
from .test_mock_factory import MockNodeFactory

logger = logging.getLogger(__name__)


@dataclass
class WorkflowTestCase:
    """Represents a single test case for table-driven testing."""

    fixture_path: str = ""
    expected_outputs: dict[str, Any] = field(default_factory=dict)
    inputs: dict[str, Any] = field(default_factory=dict)
    query: str = ""
    description: str = ""
    timeout: float = 30.0
    mock_config: MockConfig | None = None
    use_auto_mock: bool = False
    expected_event_sequence: Sequence[type[GraphEngineEvent]] | None = None
    graph_factory: Callable[[], tuple[Graph, GraphRuntimeState]] | None = None


@dataclass
class WorkflowTestResult:
    """Result of executing a single test case."""

    test_case: WorkflowTestCase
    success: bool
    error: Exception | None = None
    actual_outputs: dict[str, Any] | None = None
    execution_time: float = 0.0
    event_sequence_match: bool | None = None
    event_mismatch_details: str | None = None
    events: list[GraphEngineEvent] = field(default_factory=list)
    graph: Graph | None = None
    graph_runtime_state: GraphRuntimeState | None = None
    validation_details: str | None = None


@dataclass
class TestSuiteResult:
    """Aggregated results for a test suite."""

    total_tests: int
    passed_tests: int
    failed_tests: int
    total_execution_time: float
    results: list[WorkflowTestResult]

    @property
    def success_rate(self) -> float:
        """Calculate the success rate of the test suite."""
        if self.total_tests == 0:
            return 0.0
        return (self.passed_tests / self.total_tests) * 100

    def get_failed_results(self) -> list[WorkflowTestResult]:
        """Get all failed test results."""
        return [r for r in self.results if not r.success]


class WorkflowRunner:
    """Core workflow execution engine for tests."""

    def __init__(self, fixtures_dir: Path | None = None):
        """Initialize the workflow runner."""
        if fixtures_dir is None:
            # Use the new central fixtures location
            # Navigate from current file to api/tests directory
            current_file = Path(__file__).resolve()
            # Find the 'api' directory by traversing up
            for parent in current_file.parents:
                if parent.name == "api" and (parent / "tests").exists():
                    fixtures_dir = parent / "tests" / "fixtures" / "workflow"
                    break
            else:
                # Fallback if structure is not as expected
                raise ValueError("Could not locate api/tests/fixtures/workflow directory")

        self.fixtures_dir = Path(fixtures_dir)
        if not self.fixtures_dir.exists():
            raise ValueError(f"Fixtures directory does not exist: {self.fixtures_dir}")

    def load_fixture(self, fixture_name: str) -> dict[str, Any]:
        """Load a YAML fixture file with caching to avoid repeated parsing."""
        if not fixture_name.endswith(".yml") and not fixture_name.endswith(".yaml"):
            fixture_name = f"{fixture_name}.yml"

        fixture_path = self.fixtures_dir / fixture_name
        return _load_fixture(fixture_path, fixture_name)

    def create_graph_from_fixture(
        self,
        fixture_data: dict[str, Any],
        query: str = "",
        inputs: dict[str, Any] | None = None,
        use_mock_factory: bool = False,
        mock_config: MockConfig | None = None,
    ) -> tuple[Graph, GraphRuntimeState]:
        """Create a Graph instance from fixture data."""
        workflow_config = fixture_data.get("workflow", {})
        graph_config = workflow_config.get("graph", {})

        if not graph_config:
            raise ValueError("Fixture missing workflow.graph configuration")

        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config=graph_config,
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",  # Set to debugger to avoid conversation_id requirement
            call_depth=0,
        )

        system_variables = SystemVariable(
            user_id=graph_init_params.user_id,
            app_id=graph_init_params.app_id,
            workflow_id=graph_init_params.workflow_id,
            files=[],
            query=query,
        )
        user_inputs = inputs if inputs is not None else {}

        # Extract conversation variables from workflow config
        conversation_variables = []
        conversation_var_configs = workflow_config.get("conversation_variables", [])

        # Mapping from value_type to Variable class
        variable_type_mapping = {
            "string": StringVariable,
            "number": FloatVariable,
            "integer": IntegerVariable,
            "object": ObjectVariable,
            "array[string]": ArrayStringVariable,
            "array[number]": ArrayNumberVariable,
            "array[object]": ArrayObjectVariable,
        }

        for var_config in conversation_var_configs:
            value_type = var_config.get("value_type", "string")
            variable_class = variable_type_mapping.get(value_type, StringVariable)

            # Create the appropriate Variable type based on value_type
            var = variable_class(
                selector=tuple(var_config.get("selector", [])),
                name=var_config.get("name", ""),
                value=var_config.get("value", ""),
            )
            conversation_variables.append(var)

        variable_pool = VariablePool(
            system_variables=system_variables,
            user_inputs=user_inputs,
            conversation_variables=conversation_variables,
        )

        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

        if use_mock_factory:
            node_factory = MockNodeFactory(
                graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state, mock_config=mock_config
            )
        else:
            node_factory = DifyNodeFactory(graph_init_params=graph_init_params, graph_runtime_state=graph_runtime_state)

        graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

        return graph, graph_runtime_state


class TableTestRunner:
    """
    Advanced table-driven test runner for workflow testing.

    Features:
    - Parallel test execution
    - Retry mechanism for flaky tests
    - Custom validators
    - Performance profiling
    - Detailed error reporting
    - Tag-based filtering
    """

    def __init__(
        self,
        fixtures_dir: Path | None = None,
        max_workers: int = 4,
        enable_logging: bool = False,
        log_level: str = "INFO",
        graph_engine_min_workers: int = 1,
        graph_engine_max_workers: int = 1,
        graph_engine_scale_up_threshold: int = 5,
        graph_engine_scale_down_idle_time: float = 30.0,
    ):
        """
        Initialize the table test runner.

        Args:
            fixtures_dir: Directory containing fixture files
            max_workers: Maximum number of parallel workers for test execution
            enable_logging: Enable detailed logging
            log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
            graph_engine_min_workers: Minimum workers for GraphEngine (default: 1)
            graph_engine_max_workers: Maximum workers for GraphEngine (default: 1)
            graph_engine_scale_up_threshold: Queue depth to trigger scale up
            graph_engine_scale_down_idle_time: Idle time before scaling down
        """
        self.workflow_runner = WorkflowRunner(fixtures_dir)
        self.max_workers = max_workers

        # Store GraphEngine worker configuration
        self.graph_engine_min_workers = graph_engine_min_workers
        self.graph_engine_max_workers = graph_engine_max_workers
        self.graph_engine_scale_up_threshold = graph_engine_scale_up_threshold
        self.graph_engine_scale_down_idle_time = graph_engine_scale_down_idle_time

        if enable_logging:
            logging.basicConfig(
                level=getattr(logging, log_level), format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
            )

        self.logger = logger

    def run_test_case(self, test_case: WorkflowTestCase) -> WorkflowTestResult:
        """
        Execute a single test case with retry support.

        Args:
            test_case: The test case to execute

        Returns:
            WorkflowTestResult with execution details
        """
        start_time = time.perf_counter()

        try:
            result = self._execute_test_case(test_case)
            if result.success:
                self.logger.info("Test passed: %s", test_case.description)
            else:
                self.logger.error("Test failed: %s", test_case.description)
            return result
        except Exception as exc:
            self.logger.exception("Error executing test case: %s", test_case.description)
            return WorkflowTestResult(
                test_case=test_case,
                success=False,
                error=exc,
                execution_time=time.perf_counter() - start_time,
            )

    def _execute_test_case(self, test_case: WorkflowTestCase) -> WorkflowTestResult:
        """Internal method to execute a single test case."""
        start_time = time.perf_counter()

        try:
            graph, graph_runtime_state = self._create_graph_runtime_state(test_case)

            # Create and run the engine with configured worker settings
            engine = GraphEngine(
                workflow_id="test_workflow",
                graph=graph,
                graph_runtime_state=graph_runtime_state,
                command_channel=InMemoryChannel(),
                config=GraphEngineConfig(
                    min_workers=self.graph_engine_min_workers,
                    max_workers=self.graph_engine_max_workers,
                    scale_up_threshold=self.graph_engine_scale_up_threshold,
                    scale_down_idle_time=self.graph_engine_scale_down_idle_time,
                ),
            )

            # Execute and collect events
            events: list[GraphEngineEvent] = []
            for event in engine.run():
                events.append(event)

            # Check execution success
            has_start = any(isinstance(e, GraphRunStartedEvent) for e in events)
            success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
            has_success = len(success_events) > 0

            # Validate event sequence if provided (even for failed workflows)
            event_sequence_match = None
            event_mismatch_details = None
            if test_case.expected_event_sequence is not None:
                event_sequence_match, event_mismatch_details = self._validate_event_sequence(
                    test_case.expected_event_sequence, events
                )

            if not (has_start and has_success):
                # Workflow didn't complete, but we may still want to validate events
                success = False
                if test_case.expected_event_sequence is not None:
                    # If event sequence was provided, use that for success determination
                    success = event_sequence_match if event_sequence_match is not None else False

                return WorkflowTestResult(
                    test_case=test_case,
                    success=success,
                    error=Exception("Workflow did not complete successfully"),
                    execution_time=time.perf_counter() - start_time,
                    events=events,
                    event_sequence_match=event_sequence_match,
                    event_mismatch_details=event_mismatch_details,
                    graph=graph,
                    graph_runtime_state=graph_runtime_state,
                )

            # Get actual outputs
            success_event = success_events[-1]
            actual_outputs = success_event.outputs or {}

            # Validate outputs
            output_success, validation_details = self._validate_outputs(test_case.expected_outputs, actual_outputs)

            # Overall success requires both output and event sequence validation
            success = output_success and (event_sequence_match if event_sequence_match is not None else True)

            return WorkflowTestResult(
                test_case=test_case,
                success=success,
                actual_outputs=actual_outputs,
                execution_time=time.perf_counter() - start_time,
                event_sequence_match=event_sequence_match,
                event_mismatch_details=event_mismatch_details,
                events=events,
                validation_details=validation_details,
                error=None if success else Exception(validation_details or event_mismatch_details or "Test failed"),
                graph=graph,
                graph_runtime_state=graph_runtime_state,
            )

        except Exception as e:
            self.logger.exception("Error executing test case: %s", test_case.description)
            return WorkflowTestResult(
                test_case=test_case,
                success=False,
                error=e,
                execution_time=time.perf_counter() - start_time,
                graph=graph if "graph" in locals() else None,
                graph_runtime_state=graph_runtime_state if "graph_runtime_state" in locals() else None,
            )

    def _create_graph_runtime_state(self, test_case: WorkflowTestCase) -> tuple[Graph, GraphRuntimeState]:
        """Create or retrieve graph/runtime state according to test configuration."""

        if test_case.graph_factory is not None:
            return test_case.graph_factory()

        if not test_case.fixture_path:
            raise ValueError("fixture_path must be provided when graph_factory is not specified")

        fixture_data = self.workflow_runner.load_fixture(test_case.fixture_path)

        return self.workflow_runner.create_graph_from_fixture(
            fixture_data=fixture_data,
            inputs=test_case.inputs,
            query=test_case.query,
            use_mock_factory=test_case.use_auto_mock,
            mock_config=test_case.mock_config,
        )

    def _validate_outputs(
        self,
        expected_outputs: dict[str, Any],
        actual_outputs: dict[str, Any],
    ) -> tuple[bool, str | None]:
        """
        Validate actual outputs against expected outputs.

        Returns:
            tuple: (is_valid, validation_details)
        """
        validation_errors = []

        # Check expected outputs
        for key, expected_value in expected_outputs.items():
            if key not in actual_outputs:
                validation_errors.append(f"Missing expected key: {key}")
                continue

            actual_value = actual_outputs[key]
            if actual_value != expected_value:
                # Format multiline strings for better readability
                if isinstance(expected_value, str) and "\n" in expected_value:
                    expected_lines = expected_value.splitlines()
                    actual_lines = (
                        actual_value.splitlines() if isinstance(actual_value, str) else str(actual_value).splitlines()
                    )

                    validation_errors.append(
                        f"Value mismatch for key '{key}':\n"
                        f"  Expected ({len(expected_lines)} lines):\n    " + "\n    ".join(expected_lines) + "\n"
                        f"  Actual ({len(actual_lines)} lines):\n    " + "\n    ".join(actual_lines)
                    )
                else:
                    validation_errors.append(
                        f"Value mismatch for key '{key}':\n  Expected: {expected_value}\n  Actual: {actual_value}"
                    )

        if validation_errors:
            return False, "\n".join(validation_errors)

        return True, None

    def _validate_event_sequence(
        self, expected_sequence: list[type[GraphEngineEvent]], actual_events: list[GraphEngineEvent]
    ) -> tuple[bool, str | None]:
        """
        Validate that actual events match the expected event sequence.

        Returns:
            tuple: (is_valid, error_message)
        """
        actual_event_types = [type(event) for event in actual_events]

        if len(expected_sequence) != len(actual_event_types):
            return False, (
                f"Event count mismatch. Expected {len(expected_sequence)} events, "
                f"got {len(actual_event_types)} events.\n"
                f"Expected: {[e.__name__ for e in expected_sequence]}\n"
                f"Actual: {[e.__name__ for e in actual_event_types]}"
            )

        for i, (expected_type, actual_type) in enumerate(zip(expected_sequence, actual_event_types)):
            if expected_type != actual_type:
                return False, (
                    f"Event mismatch at position {i}. "
                    f"Expected {expected_type.__name__}, got {actual_type.__name__}\n"
                    f"Full expected sequence: {[e.__name__ for e in expected_sequence]}\n"
                    f"Full actual sequence: {[e.__name__ for e in actual_event_types]}"
                )

        return True, None

    def run_table_tests(
        self,
        test_cases: list[WorkflowTestCase],
        parallel: bool = False,
        fail_fast: bool = False,
    ) -> TestSuiteResult:
        """
        Run multiple test cases as a table test suite.

        Args:
            test_cases: List of test cases to execute
            parallel: Run tests in parallel
        fail_fast: Stop execution on first failure

        Returns:
            TestSuiteResult with aggregated results
        """
        if not test_cases:
            return TestSuiteResult(
                total_tests=0,
                passed_tests=0,
                failed_tests=0,
                total_execution_time=0.0,
                results=[],
            )

        start_time = time.perf_counter()
        results = []

        if parallel and self.max_workers > 1:
            results = self._run_parallel(test_cases, fail_fast)
        else:
            results = self._run_sequential(test_cases, fail_fast)

        # Calculate statistics
        total_tests = len(results)
        passed_tests = sum(1 for r in results if r.success)
        failed_tests = total_tests - passed_tests
        total_execution_time = time.perf_counter() - start_time

        return TestSuiteResult(
            total_tests=total_tests,
            passed_tests=passed_tests,
            failed_tests=failed_tests,
            total_execution_time=total_execution_time,
            results=results,
        )

    def _run_sequential(self, test_cases: list[WorkflowTestCase], fail_fast: bool) -> list[WorkflowTestResult]:
        """Run tests sequentially."""
        results = []

        for test_case in test_cases:
            result = self.run_test_case(test_case)
            results.append(result)

            if fail_fast and not result.success:
                self.logger.info("Fail-fast enabled: stopping execution")
                break

        return results

    def _run_parallel(self, test_cases: list[WorkflowTestCase], fail_fast: bool) -> list[WorkflowTestResult]:
        """Run tests in parallel."""
        results = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_test = {executor.submit(self.run_test_case, tc): tc for tc in test_cases}

            for future in as_completed(future_to_test):
                test_case = future_to_test[future]

                try:
                    result = future.result()
                    results.append(result)

                    if fail_fast and not result.success:
                        self.logger.info("Fail-fast enabled: cancelling remaining tests")
                        for remaining_future in future_to_test:
                            if not remaining_future.done():
                                remaining_future.cancel()
                        break

                except Exception as e:
                    self.logger.exception("Error in parallel execution for test: %s", test_case.description)
                    results.append(
                        WorkflowTestResult(
                            test_case=test_case,
                            success=False,
                            error=e,
                        )
                    )

                    if fail_fast:
                        for remaining_future in future_to_test:
                            if not remaining_future.done():
                                remaining_future.cancel()
                        break

        return results

    def generate_report(self, suite_result: TestSuiteResult) -> str:
        """
        Generate a detailed test report.

        Args:
            suite_result: Test suite results

        Returns:
            Formatted report string
        """
        report = []
        report.append("=" * 80)
        report.append("TEST SUITE REPORT")
        report.append("=" * 80)
        report.append("")

        # Summary
        report.append("SUMMARY:")
        report.append(f"  Total Tests: {suite_result.total_tests}")
        report.append(f"  Passed: {suite_result.passed_tests}")
        report.append(f"  Failed: {suite_result.failed_tests}")
        report.append(f"  Success Rate: {suite_result.success_rate:.1f}%")
        report.append(f"  Total Time: {suite_result.total_execution_time:.2f}s")
        report.append("")

        # Failed tests details
        failed_results = suite_result.get_failed_results()
        if failed_results:
            report.append("FAILED TESTS:")
            for result in failed_results:
                report.append(f"  - {result.test_case.description}")
                if result.error:
                    report.append(f"    Error: {str(result.error)}")
                if result.validation_details:
                    report.append(f"    Validation: {result.validation_details}")
                if result.event_mismatch_details:
                    report.append(f"    Events: {result.event_mismatch_details}")
                report.append("")

        # Performance metrics
        report.append("PERFORMANCE:")
        sorted_results = sorted(suite_result.results, key=lambda r: r.execution_time, reverse=True)[:5]

        report.append("  Slowest Tests:")
        for result in sorted_results:
            report.append(f"    - {result.test_case.description}: {result.execution_time:.2f}s")

        report.append("=" * 80)

        return "\n".join(report)


@lru_cache(maxsize=32)
def _load_fixture(fixture_path: Path, fixture_name: str) -> dict[str, Any]:
    """Load a YAML fixture file with caching to avoid repeated parsing."""
    if not fixture_path.exists():
        raise FileNotFoundError(f"Fixture file not found: {fixture_path}")

    return _load_yaml_file(file_path=str(fixture_path))

"""
Test suite for complex branch workflow with parallel execution and conditional routing.

This test suite validates the behavior of a workflow that:
1. Executes nodes in parallel (IF/ELSE and LLM branches)
2. Routes based on conditional logic (query containing 'hello')
3. Handles multiple answer nodes with different outputs
"""

import pytest

from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


class TestComplexBranchWorkflow:
    """Test suite for complex branch workflow with parallel execution."""

    def setup_method(self):
        """Set up test environment before each test method."""
        self.runner = TableTestRunner()
        self.fixture_path = "test_complex_branch"

    @pytest.mark.skip(reason="output in this workflow can be random")
    def test_hello_branch_with_llm(self):
        """
        Test when query contains 'hello' - should trigger true branch.
        Both IF/ELSE and LLM should execute in parallel.
        """
        mock_text_1 = "This is a mocked LLM response for hello world"
        test_cases = [
            WorkflowTestCase(
                fixture_path=self.fixture_path,
                query="hello world",
                expected_outputs={
                    "answer": f"{mock_text_1}contains 'hello'",
                },
                description="Basic hello case with parallel LLM execution",
                use_auto_mock=True,
                mock_config=(MockConfigBuilder().with_node_output("1755502777322", {"text": mock_text_1}).build()),
                expected_event_sequence=[
                    GraphRunStartedEvent,
                    # Start
                    NodeRunStartedEvent,
                    NodeRunSucceededEvent,
                    # If/Else (no streaming)
                    NodeRunStartedEvent,
                    NodeRunSucceededEvent,
                    # LLM (with streaming)
                    NodeRunStartedEvent,
                ]
                # LLM
                + [NodeRunStreamChunkEvent] * (mock_text_1.count(" ") + 2)
                + [
                    # Answer's text
                    NodeRunStreamChunkEvent,
                    NodeRunSucceededEvent,
                    # Answer
                    NodeRunStartedEvent,
                    NodeRunSucceededEvent,
                    # Answer 2
                    NodeRunStartedEvent,
                    NodeRunSucceededEvent,
                    GraphRunSucceededEvent,
                ],
            ),
            WorkflowTestCase(
                fixture_path=self.fixture_path,
                query="say hello to everyone",
                expected_outputs={
                    "answer": "Mocked response for greetingcontains 'hello'",
                },
                description="Hello in middle of sentence",
                use_auto_mock=True,
                mock_config=(
                    MockConfigBuilder()
                    .with_node_output("1755502777322", {"text": "Mocked response for greeting"})
                    .build()
                ),
            ),
        ]

        suite_result = self.runner.run_table_tests(test_cases)

        for result in suite_result.results:
            assert result.success, f"Test '{result.test_case.description}' failed: {result.error}"
            assert result.actual_outputs

    def test_non_hello_branch_with_llm(self):
        """
        Test when query doesn't contain 'hello' - should trigger false branch.
        LLM output should be used as the final answer.
        """
        test_cases = [
            WorkflowTestCase(
                fixture_path=self.fixture_path,
                query="goodbye world",
                expected_outputs={
                    "answer": "Mocked LLM response for goodbye",
                },
                description="Goodbye case - false branch with LLM output",
                use_auto_mock=True,
                mock_config=(
                    MockConfigBuilder()
                    .with_node_output("1755502777322", {"text": "Mocked LLM response for goodbye"})
                    .build()
                ),
            ),
            WorkflowTestCase(
                fixture_path=self.fixture_path,
                query="test message",
                expected_outputs={
                    "answer": "Mocked response for test",
                },
                description="Regular message - false branch",
                use_auto_mock=True,
                mock_config=(
                    MockConfigBuilder().with_node_output("1755502777322", {"text": "Mocked response for test"}).build()
                ),
            ),
        ]

        suite_result = self.runner.run_table_tests(test_cases)

        for result in suite_result.results:
            assert result.success, f"Test '{result.test_case.description}' failed: {result.error}"

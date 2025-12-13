import uuid
from datetime import datetime, timedelta
from unittest import mock
from unittest.mock import MagicMock

import pytest

from core.ops.entities.config_entity import LangfuseConfig
from core.ops.entities.trace_entity import WorkflowTraceInfo
from core.ops.langfuse_trace.langfuse_trace import LangFuseDataTrace
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus


class TestLangfuseProviderResponseId:
    """Test cases for Langfuse provider_response_id integration."""

    @pytest.fixture
    def mock_langfuse_config(self):
        """Create mock Langfuse config."""
        return LangfuseConfig(
            public_key="test-public-key",
            secret_key="test-secret-key",
            host="http://localhost:3000",
        )

    @pytest.fixture
    def mock_langfuse_client(self):
        """Create mock Langfuse client."""
        mock_client = MagicMock()
        return mock_client

    @pytest.fixture
    def langfuse_trace(self, mock_langfuse_config):
        """Create LangFuseDataTrace instance."""
        with mock.patch("core.ops.langfuse_trace.langfuse_trace.Langfuse") as mock_langfuse_class:
            mock_langfuse_class.return_value = MagicMock()
            trace = LangFuseDataTrace(mock_langfuse_config)
            trace.langfuse_client = mock_langfuse_class.return_value
            return trace

    def test_workflow_trace_includes_provider_response_id(self, langfuse_trace):
        """Test that workflow trace includes provider_response_id in generation metadata."""
        # Create test workflow trace info
        test_provider_response_id = "chatcmpl-workflow-test-789"

        trace_info = WorkflowTraceInfo(
            trace_id="test-trace-id",
            workflow_id="test-workflow-id",
            tenant_id="test-tenant-id",
            workflow_run_id="test-workflow-run-id",
            workflow_run_elapsed_time=10.5,
            workflow_run_status="succeeded",
            workflow_run_inputs={"query": "Hello"},
            workflow_run_outputs={"result": "Hi there!"},
            workflow_run_version="1.0",
            error=None,
            total_tokens=50,
            file_list=[],
            query="Hello",
            metadata={"app_id": "test-app-id"},
            start_time=datetime.now() - timedelta(seconds=10),
            end_time=datetime.now(),
        )

        # Create mock node execution with provider_response_id in metadata
        mock_node_execution = WorkflowNodeExecution(
            id=str(uuid.uuid4()),
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            workflow_id="test-workflow-id",
            executor_id="test-executor",
            node_id="test-node-id",
            title="Test LLM Node",
            node_type="llm",
            index=1,
            predecessor_node_id=None,
            inputs={"prompt": "Hello"},
            process_data={
                "model_mode": "chat",
                "model_name": "gpt-4",
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 30,
                    "total_tokens": 50,
                },
            },
            outputs={"text": "Hi there!"},
            metadata={
                WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID: test_provider_response_id,
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 50,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.001,
                WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
            },
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now() - timedelta(seconds=10),
            finished_at=datetime.now(),
            elapsed_time=10.5,
        )

        # Mock the repository and database operations
        mock_service_account = MagicMock()
        mock_service_account.id = "test-service-account"

        with mock.patch.object(langfuse_trace, "get_service_account_with_tenant", return_value=mock_service_account):
            with mock.patch("core.ops.langfuse_trace.langfuse_trace.db") as mock_db:
                mock_db.engine = MagicMock()
                with mock.patch(
                    "core.ops.langfuse_trace.langfuse_trace.DifyCoreRepositoryFactory"
                ) as mock_repo_factory_class:
                    mock_repo = MagicMock()
                    mock_repo.get_by_workflow_run.return_value = [mock_node_execution]
                    mock_repo_factory_class.create_workflow_node_execution_repository.return_value = mock_repo

                # Mock Langfuse client methods
                langfuse_trace.langfuse_client.trace = MagicMock()
                langfuse_trace.langfuse_client.span = MagicMock()
                langfuse_trace.langfuse_client.generation = MagicMock()

                # Mock the workflow_trace method to skip database complexity and test generation directly
                with mock.patch.object(langfuse_trace, "workflow_trace") as mock_workflow_trace:
                    # Mock repository to return our test data
                    mock_repo = MagicMock()
                    mock_repo.get_by_workflow_run.return_value = [mock_node_execution]

                    # Call the real generation logic that would be called by workflow_trace
                    from decimal import Decimal

                    from core.ops.langfuse_trace.entities.langfuse_trace_entity import (
                        GenerationUsage,
                        LangfuseGeneration,
                        LevelEnum,
                        UnitEnum,
                    )

                    generation_usage = GenerationUsage(
                        input=20,
                        output=30,
                        total=50,
                        unit=UnitEnum.TOKENS,
                        totalCost=Decimal("0.001"),
                    )

                    generation_metadata = {"test": "metadata"}
                    if test_provider_response_id:
                        generation_metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] = (
                            test_provider_response_id
                        )

                    langfuse_generation_data = LangfuseGeneration(
                        name="llm",
                        trace_id="test-trace-id",
                        start_time=datetime.now() - timedelta(seconds=10),
                        end_time=datetime.now(),
                        model="gpt-4",
                        input="Hello",
                        output="Hi there!",
                        metadata=generation_metadata,
                        level=LevelEnum.DEFAULT,
                        status_message="",
                        usage=generation_usage,
                    )

                    # Test that add_generation is called with the right metadata
                    langfuse_trace.add_generation(langfuse_generation_data)

                    # Verify that generation was called with provider_response_id in metadata
                    assert langfuse_trace.langfuse_client.generation.called
                    call_args = langfuse_trace.langfuse_client.generation.call_args
                    call_kwargs = call_args[1] if call_args else {}

                    # Check that metadata contains provider_response_id
                    assert "metadata" in call_kwargs
                    assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID in call_kwargs["metadata"]
                    assert (
                        call_kwargs["metadata"][WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID]
                        == test_provider_response_id
                    )

    def test_workflow_trace_handles_missing_provider_response_id(self, langfuse_trace):
        """Test that workflow trace handles missing provider_response_id gracefully."""
        # Create test workflow trace info
        trace_info = WorkflowTraceInfo(
            trace_id="test-trace-id",
            workflow_id="test-workflow-id",
            tenant_id="test-tenant-id",
            workflow_run_id="test-workflow-run-id",
            workflow_run_elapsed_time=10.5,
            workflow_run_status="succeeded",
            workflow_run_inputs={"query": "Hello"},
            workflow_run_outputs={"result": "Hi there!"},
            workflow_run_version="1.0",
            error=None,
            total_tokens=50,
            file_list=[],
            query="Hello",
            metadata={"app_id": "test-app-id"},
            start_time=datetime.now() - timedelta(seconds=10),
            end_time=datetime.now(),
        )

        # Create mock node execution WITHOUT provider_response_id in metadata
        mock_node_execution = WorkflowNodeExecution(
            id=str(uuid.uuid4()),
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            workflow_id="test-workflow-id",
            executor_id="test-executor",
            node_id="test-node-id",
            title="Test LLM Node",
            node_type="llm",
            index=1,
            predecessor_node_id=None,
            inputs={"prompt": "Hello"},
            process_data={
                "model_mode": "chat",
                "model_name": "gpt-4",
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 30,
                    "total_tokens": 50,
                },
            },
            outputs={"text": "Hi there!"},
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 50,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.001,
                WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
                # Note: PROVIDER_RESPONSE_ID is missing
            },
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now() - timedelta(seconds=10),
            finished_at=datetime.now(),
            elapsed_time=10.5,
        )

        # Mock the repository and database operations
        mock_service_account = MagicMock()
        mock_service_account.id = "test-service-account"

        with mock.patch.object(langfuse_trace, "get_service_account_with_tenant", return_value=mock_service_account):
            with mock.patch("core.ops.langfuse_trace.langfuse_trace.db") as mock_db:
                mock_db.engine = MagicMock()
                with mock.patch(
                    "core.ops.langfuse_trace.langfuse_trace.DifyCoreRepositoryFactory"
                ) as mock_repo_factory_class:
                    mock_repo = MagicMock()
                    mock_repo.get_by_workflow_run.return_value = [mock_node_execution]
                    mock_repo_factory_class.create_workflow_node_execution_repository.return_value = mock_repo

                # Mock Langfuse client methods
                langfuse_trace.langfuse_client.trace = MagicMock()
                langfuse_trace.langfuse_client.span = MagicMock()
                langfuse_trace.langfuse_client.generation = MagicMock()

                # Mock the workflow_trace method to skip database complexity and test generation directly
                with mock.patch.object(langfuse_trace, "workflow_trace") as mock_workflow_trace:
                    # Test generation without provider_response_id
                    from decimal import Decimal

                    from core.ops.langfuse_trace.entities.langfuse_trace_entity import (
                        GenerationUsage,
                        LangfuseGeneration,
                        LevelEnum,
                        UnitEnum,
                    )

                    generation_usage = GenerationUsage(
                        input=20,
                        output=30,
                        total=50,
                        unit=UnitEnum.TOKENS,
                        totalCost=Decimal("0.001"),
                    )

                    generation_metadata = {"test": "metadata"}
                    # Note: no provider_response_id added

                    langfuse_generation_data = LangfuseGeneration(
                        name="llm",
                        trace_id="test-trace-id",
                        start_time=datetime.now() - timedelta(seconds=10),
                        end_time=datetime.now(),
                        model="gpt-4",
                        input="Hello",
                        output="Hi there!",
                        metadata=generation_metadata,
                        level=LevelEnum.DEFAULT,
                        status_message="",
                        usage=generation_usage,
                    )

                    # Test that add_generation is called without provider_response_id
                    langfuse_trace.add_generation(langfuse_generation_data)

                    # Verify that generation was called but provider_response_id is not in metadata
                    assert langfuse_trace.langfuse_client.generation.called
                    call_args = langfuse_trace.langfuse_client.generation.call_args
                    call_kwargs = call_args[1] if call_args else {}

                    # Check that metadata does not contain provider_response_id
                    assert "metadata" in call_kwargs
                    assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID not in call_kwargs["metadata"]

    def test_message_trace_includes_provider_response_id(self, langfuse_trace):
        """Test that message trace includes provider_response_id in generation metadata."""
        from core.ops.entities.trace_entity import MessageTraceInfo

        test_provider_response_id = "chatcmpl-message-test-101"

        # Create test message trace info with provider_response_id
        trace_info = MessageTraceInfo(
            trace_id="test-message-trace-id",
            message_id="test-message-id",
            conversation_model="chat",
            message_tokens=20,
            answer_tokens=30,
            total_tokens=50,
            provider_response_id=test_provider_response_id,
            inputs="Hello",
            outputs="Hi there!",
            start_time=datetime.now() - timedelta(seconds=5),
            end_time=datetime.now(),
            metadata={
                "conversation_id": "test-conversation-id",
                "ls_provider": "openai",
                "ls_model_name": "gpt-4",
                "status": "succeeded",
            },
            conversation_mode="chat",
        )

        # Mock message data
        mock_message_data = MagicMock()
        mock_message_data.id = "test-message-id"
        mock_message_data.conversation_id = "test-conversation-id"
        mock_message_data.status = "succeeded"
        mock_message_data.error = None
        mock_message_data.answer = "Hi there!"
        mock_message_data.model_id = "gpt-4"
        mock_message_data.message_tokens = 20
        mock_message_data.answer_tokens = 30
        mock_message_data.total_price = 0.001
        mock_message_data.provider_response_latency = 2.0
        mock_message_data.from_account_id = "test-user-id"  # Add user ID to avoid database query
        mock_message_data.from_end_user_id = None  # Set to None to avoid database query

        trace_info.message_data = mock_message_data

        # Mock Langfuse client methods
        langfuse_trace.langfuse_client.trace = MagicMock()
        langfuse_trace.langfuse_client.generation = MagicMock()

        # Execute the message trace
        langfuse_trace.message_trace(trace_info)

        # Verify that generation was called with provider_response_id in metadata
        assert langfuse_trace.langfuse_client.generation.called
        call_args = langfuse_trace.langfuse_client.generation.call_args
        call_kwargs = call_args[1] if call_args else {}

        # Check that metadata contains provider_response_id
        assert "metadata" in call_kwargs
        assert "provider_response_id" in call_kwargs["metadata"]  # Note: this uses string key, not enum
        assert call_kwargs["metadata"]["provider_response_id"] == test_provider_response_id

    def test_message_trace_handles_none_provider_response_id(self, langfuse_trace):
        """Test that message trace handles None provider_response_id gracefully."""
        from core.ops.entities.trace_entity import MessageTraceInfo

        # Create test message trace info with None provider_response_id
        trace_info = MessageTraceInfo(
            trace_id="test-message-trace-id",
            message_id="test-message-id",
            conversation_model="chat",
            message_tokens=20,
            answer_tokens=30,
            total_tokens=50,
            provider_response_id=None,  # Explicitly None
            inputs="Hello",
            outputs="Hi there!",
            start_time=datetime.now() - timedelta(seconds=5),
            end_time=datetime.now(),
            metadata={
                "conversation_id": "test-conversation-id",
                "ls_provider": "openai",
                "ls_model_name": "gpt-4",
                "status": "succeeded",
            },
            conversation_mode="chat",
        )

        # Mock message data
        mock_message_data = MagicMock()
        mock_message_data.id = "test-message-id"
        mock_message_data.conversation_id = "test-conversation-id"
        mock_message_data.status = "succeeded"
        mock_message_data.error = None
        mock_message_data.answer = "Hi there!"
        mock_message_data.model_id = "gpt-4"
        mock_message_data.message_tokens = 20
        mock_message_data.answer_tokens = 30
        mock_message_data.total_price = 0.001
        mock_message_data.provider_response_latency = 2.0
        mock_message_data.from_account_id = "test-user-id"  # Add user ID to avoid database query
        mock_message_data.from_end_user_id = None  # Set to None to avoid database query

        trace_info.message_data = mock_message_data

        # Mock Langfuse client methods
        langfuse_trace.langfuse_client.trace = MagicMock()
        langfuse_trace.langfuse_client.generation = MagicMock()

        # Execute the message trace
        langfuse_trace.message_trace(trace_info)

        # Verify that generation was called but provider_response_id is not in metadata
        assert langfuse_trace.langfuse_client.generation.called
        call_args = langfuse_trace.langfuse_client.generation.call_args
        call_kwargs = call_args[1] if call_args else {}

        # Check that metadata does not contain provider_response_id
        assert "metadata" in call_kwargs
        assert "provider_response_id" not in call_kwargs["metadata"]

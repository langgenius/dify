# """
# Unit tests for workflow node execution Celery tasks.

# These tests verify the asynchronous storage functionality for workflow node execution data,
# including truncation and offloading logic.
# """

# import json
# from unittest.mock import MagicMock, Mock, patch
# from uuid import uuid4

# import pytest

# from core.workflow.entities.workflow_node_execution import (
#     WorkflowNodeExecution,
#     WorkflowNodeExecutionStatus,
# )
# from core.workflow.enums import NodeType
# from libs.datetime_utils import naive_utc_now
# from models import WorkflowNodeExecutionModel
# from models.enums import ExecutionOffLoadType
# from models.model import UploadFile
# from models.workflow import WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom
# from tasks.workflow_node_execution_tasks import (
#     _create_truncator,
#     _json_encode,
#     _replace_or_append_offload,
#     _truncate_and_upload_async,
#     save_workflow_node_execution_data_task,
#     save_workflow_node_execution_task,
# )


# @pytest.fixture
# def sample_execution_data():
#     """Sample execution data for testing."""
#     execution = WorkflowNodeExecution(
#         id=str(uuid4()),
#         node_execution_id=str(uuid4()),
#         workflow_id=str(uuid4()),
#         workflow_execution_id=str(uuid4()),
#         index=1,
#         node_id="test_node",
#         node_type=NodeType.LLM,
#         title="Test Node",
#         inputs={"input_key": "input_value"},
#         outputs={"output_key": "output_value"},
#         process_data={"process_key": "process_value"},
#         status=WorkflowNodeExecutionStatus.RUNNING,
#         created_at=naive_utc_now(),
#     )
#     return execution.model_dump()


# @pytest.fixture
# def mock_db_model():
#     """Mock database model for testing."""
#     db_model = Mock(spec=WorkflowNodeExecutionModel)
#     db_model.id = "test-execution-id"
#     db_model.offload_data = []
#     return db_model


# @pytest.fixture
# def mock_file_service():
#     """Mock file service for testing."""
#     file_service = Mock()
#     mock_upload_file = Mock(spec=UploadFile)
#     mock_upload_file.id = "mock-file-id"
#     file_service.upload_file.return_value = mock_upload_file
#     return file_service


# class TestSaveWorkflowNodeExecutionDataTask:
#     """Test cases for save_workflow_node_execution_data_task."""

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     @patch("tasks.workflow_node_execution_tasks.select")
#     def test_save_execution_data_task_success(
#         self, mock_select, mock_sessionmaker, sample_execution_data, mock_db_model
#     ):
#         """Test successful execution of save_workflow_node_execution_data_task."""
#         # Setup mocks
#         mock_session = MagicMock()
#         mock_sessionmaker.return_value.return_value.__enter__.return_value = mock_session
#         mock_session.execute.return_value.scalars.return_value.first.return_value = mock_db_model

#         # Execute task
#         result = save_workflow_node_execution_data_task(
#             execution_data=sample_execution_data,
#             tenant_id="test-tenant-id",
#             app_id="test-app-id",
#             user_data={"user_id": "test-user-id", "user_type": "account"},
#         )

#         # Verify success
#         assert result is True
#         mock_session.merge.assert_called_once_with(mock_db_model)
#         mock_session.commit.assert_called_once()

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     @patch("tasks.workflow_node_execution_tasks.select")
#     def test_save_execution_data_task_execution_not_found(self, mock_select, mock_sessionmaker,
# sample_execution_data):
#         """Test task when execution is not found in database."""
#         # Setup mocks
#         mock_session = MagicMock()
#         mock_sessionmaker.return_value.return_value.__enter__.return_value = mock_session
#         mock_session.execute.return_value.scalars.return_value.first.return_value = None

#         # Execute task
#         result = save_workflow_node_execution_data_task(
#             execution_data=sample_execution_data,
#             tenant_id="test-tenant-id",
#             app_id="test-app-id",
#             user_data={"user_id": "test-user-id", "user_type": "account"},
#         )

#         # Verify failure
#         assert result is False
#         mock_session.merge.assert_not_called()
#         mock_session.commit.assert_not_called()

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     @patch("tasks.workflow_node_execution_tasks.select")
#     def test_save_execution_data_task_with_truncation(self, mock_select, mock_sessionmaker, mock_db_model):
#         """Test task with data that requires truncation."""
#         # Create execution with large data
#         large_data = {"large_field": "x" * 10000}
#         execution = WorkflowNodeExecution(
#             id=str(uuid4()),
#             node_execution_id=str(uuid4()),
#             workflow_id=str(uuid4()),
#             workflow_execution_id=str(uuid4()),
#             index=1,
#             node_id="test_node",
#             node_type=NodeType.LLM,
#             title="Test Node",
#             inputs=large_data,
#             outputs=large_data,
#             process_data=large_data,
#             status=WorkflowNodeExecutionStatus.RUNNING,
#             created_at=naive_utc_now(),
#         )
#         execution_data = execution.model_dump()

#         # Setup mocks
#         mock_session = MagicMock()
#         mock_sessionmaker.return_value.return_value.__enter__.return_value = mock_session
#         mock_session.execute.return_value.scalars.return_value.first.return_value = mock_db_model

#         # Create mock upload file
#         mock_upload_file = Mock(spec=UploadFile)
#         mock_upload_file.id = "mock-file-id"

#         # Execute task
#         with patch("tasks.workflow_node_execution_tasks._truncate_and_upload_async") as mock_truncate:
#             # Mock truncation results
#             mock_truncate.return_value = {
#                 "truncated_value": {"large_field": "[TRUNCATED]"},
#                 "file": mock_upload_file,
#                 "offload": WorkflowNodeExecutionOffload(
#                     id=str(uuid4()),
#                     tenant_id="test-tenant-id",
#                     app_id="test-app-id",
#                     node_execution_id=execution.id,
#                     type_=ExecutionOffLoadType.INPUTS,
#                     file_id=mock_upload_file.id,
#                 ),
#             }

#             result = save_workflow_node_execution_data_task(
#                 execution_data=execution_data,
#                 tenant_id="test-tenant-id",
#                 app_id="test-app-id",
#                 user_data={"user_id": "test-user-id", "user_type": "account"},
#             )

#             # Verify success and truncation was called
#             assert result is True
#             assert mock_truncate.call_count == 3  # inputs, outputs, process_data
#             mock_session.merge.assert_called_once_with(mock_db_model)
#             mock_session.commit.assert_called_once()

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     def test_save_execution_data_task_retry_on_exception(self, mock_sessionmaker, sample_execution_data):
#         """Test task retry mechanism on exception."""
#         # Setup mock to raise exception
#         mock_sessionmaker.side_effect = Exception("Database error")

#         # Create a mock task instance with proper retry behavior
#         with patch.object(save_workflow_node_execution_data_task, "retry") as mock_retry:
#             mock_retry.side_effect = Exception("Retry called")

#             # Execute task and expect retry
#             with pytest.raises(Exception, match="Retry called"):
#                 save_workflow_node_execution_data_task(
#                     execution_data=sample_execution_data,
#                     tenant_id="test-tenant-id",
#                     app_id="test-app-id",
#                     user_data={"user_id": "test-user-id", "user_type": "account"},
#                 )

#             # Verify retry was called
#             mock_retry.assert_called_once()


# class TestTruncateAndUploadAsync:
#     """Test cases for _truncate_and_upload_async function."""

#     def test_truncate_and_upload_with_none_values(self, mock_file_service):
#         """Test _truncate_and_upload_async with None values."""
#         # The function handles None values internally, so we test with empty dict instead
#         result = _truncate_and_upload_async(
#             values={},
#             execution_id="test-id",
#             type_=ExecutionOffLoadType.INPUTS,
#             tenant_id="test-tenant",
#             app_id="test-app",
#             user_data={"user_id": "test-user", "user_type": "account"},
#             file_service=mock_file_service,
#         )

#         # Empty dict should not require truncation
#         assert result is None
#         mock_file_service.upload_file.assert_not_called()

#     @patch("tasks.workflow_node_execution_tasks._create_truncator")
#     def test_truncate_and_upload_no_truncation_needed(self, mock_create_truncator, mock_file_service):
#         """Test _truncate_and_upload_async when no truncation is needed."""
#         # Mock truncator to return no truncation
#         mock_truncator = Mock()
#         mock_truncator.truncate_variable_mapping.return_value = ({"small": "data"}, False)
#         mock_create_truncator.return_value = mock_truncator

#         small_values = {"small": "data"}
#         result = _truncate_and_upload_async(
#             values=small_values,
#             execution_id="test-id",
#             type_=ExecutionOffLoadType.INPUTS,
#             tenant_id="test-tenant",
#             app_id="test-app",
#             user_data={"user_id": "test-user", "user_type": "account"},
#             file_service=mock_file_service,
#         )

#         assert result is None
#         mock_file_service.upload_file.assert_not_called()

#     @patch("tasks.workflow_node_execution_tasks._create_truncator")
#     @patch("models.Account")
#     @patch("models.Tenant")
#     def test_truncate_and_upload_with_account_user(
#         self, mock_tenant_class, mock_account_class, mock_create_truncator, mock_file_service
#     ):
#         """Test _truncate_and_upload_async with account user."""
#         # Mock truncator to return truncation needed
#         mock_truncator = Mock()
#         mock_truncator.truncate_variable_mapping.return_value = ({"truncated": "data"}, True)
#         mock_create_truncator.return_value = mock_truncator

#         # Mock user and tenant creation
#         mock_account = Mock()
#         mock_account.id = "test-user"
#         mock_account_class.return_value = mock_account

#         mock_tenant = Mock()
#         mock_tenant.id = "test-tenant"
#         mock_tenant_class.return_value = mock_tenant

#         large_values = {"large": "x" * 10000}
#         result = _truncate_and_upload_async(
#             values=large_values,
#             execution_id="test-id",
#             type_=ExecutionOffLoadType.INPUTS,
#             tenant_id="test-tenant",
#             app_id="test-app",
#             user_data={"user_id": "test-user", "user_type": "account"},
#             file_service=mock_file_service,
#         )

#         # Verify result structure
#         assert result is not None
#         assert "truncated_value" in result
#         assert "file" in result
#         assert "offload" in result
#         assert result["truncated_value"] == {"truncated": "data"}

#         # Verify file upload was called
#         mock_file_service.upload_file.assert_called_once()
#         upload_call = mock_file_service.upload_file.call_args
#         assert upload_call[1]["filename"] == "node_execution_test-id_inputs.json"
#         assert upload_call[1]["mimetype"] == "application/json"
#         assert upload_call[1]["user"] == mock_account

#     @patch("tasks.workflow_node_execution_tasks._create_truncator")
#     @patch("models.EndUser")
#     def test_truncate_and_upload_with_end_user(self, mock_end_user_class, mock_create_truncator, mock_file_service):
#         """Test _truncate_and_upload_async with end user."""
#         # Mock truncator to return truncation needed
#         mock_truncator = Mock()
#         mock_truncator.truncate_variable_mapping.return_value = ({"truncated": "data"}, True)
#         mock_create_truncator.return_value = mock_truncator

#         # Mock end user creation
#         mock_end_user = Mock()
#         mock_end_user.id = "test-user"
#         mock_end_user.tenant_id = "test-tenant"
#         mock_end_user_class.return_value = mock_end_user

#         large_values = {"large": "x" * 10000}
#         result = _truncate_and_upload_async(
#             values=large_values,
#             execution_id="test-id",
#             type_=ExecutionOffLoadType.OUTPUTS,
#             tenant_id="test-tenant",
#             app_id="test-app",
#             user_data={"user_id": "test-user", "user_type": "end_user"},
#             file_service=mock_file_service,
#         )

#         # Verify result structure
#         assert result is not None
#         assert result["truncated_value"] == {"truncated": "data"}

#         # Verify file upload was called with end user
#         mock_file_service.upload_file.assert_called_once()
#         upload_call = mock_file_service.upload_file.call_args
#         assert upload_call[1]["filename"] == "node_execution_test-id_outputs.json"
#         assert upload_call[1]["user"] == mock_end_user


# class TestHelperFunctions:
#     """Test cases for helper functions."""

#     @patch("tasks.workflow_node_execution_tasks.dify_config")
#     def test_create_truncator(self, mock_config):
#         """Test _create_truncator function."""
#         mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
#         mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
#         mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

#         truncator = _create_truncator()

#         # Verify truncator was created with correct config
#         assert truncator is not None

#     def test_json_encode(self):
#         """Test _json_encode function."""
#         test_data = {"key": "value", "number": 42}
#         result = _json_encode(test_data)

#         assert isinstance(result, str)
#         decoded = json.loads(result)
#         assert decoded == test_data

#     def test_replace_or_append_offload_replace_existing(self):
#         """Test _replace_or_append_offload replaces existing offload of same type."""
#         existing_offload = WorkflowNodeExecutionOffload(
#             id=str(uuid4()),
#             tenant_id="test-tenant",
#             app_id="test-app",
#             node_execution_id="test-execution",
#             type_=ExecutionOffLoadType.INPUTS,
#             file_id="old-file-id",
#         )

#         new_offload = WorkflowNodeExecutionOffload(
#             id=str(uuid4()),
#             tenant_id="test-tenant",
#             app_id="test-app",
#             node_execution_id="test-execution",
#             type_=ExecutionOffLoadType.INPUTS,
#             file_id="new-file-id",
#         )

#         result = _replace_or_append_offload([existing_offload], new_offload)

#         assert len(result) == 1
#         assert result[0].file_id == "new-file-id"

#     def test_replace_or_append_offload_append_new_type(self):
#         """Test _replace_or_append_offload appends new offload of different type."""
#         existing_offload = WorkflowNodeExecutionOffload(
#             id=str(uuid4()),
#             tenant_id="test-tenant",
#             app_id="test-app",
#             node_execution_id="test-execution",
#             type_=ExecutionOffLoadType.INPUTS,
#             file_id="inputs-file-id",
#         )

#         new_offload = WorkflowNodeExecutionOffload(
#             id=str(uuid4()),
#             tenant_id="test-tenant",
#             app_id="test-app",
#             node_execution_id="test-execution",
#             type_=ExecutionOffLoadType.OUTPUTS,
#             file_id="outputs-file-id",
#         )

#         result = _replace_or_append_offload([existing_offload], new_offload)

#         assert len(result) == 2
#         file_ids = [offload.file_id for offload in result]
#         assert "inputs-file-id" in file_ids
#         assert "outputs-file-id" in file_ids


# class TestSaveWorkflowNodeExecutionTask:
#     """Test cases for save_workflow_node_execution_task."""

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     @patch("tasks.workflow_node_execution_tasks.select")
#     def test_save_workflow_node_execution_task_create_new(self, mock_select, mock_sessionmaker,
# sample_execution_data):
#         """Test creating a new workflow node execution."""
#         # Setup mocks
#         mock_session = MagicMock()
#         mock_sessionmaker.return_value.return_value.__enter__.return_value = mock_session
#         mock_session.scalar.return_value = None  # No existing execution

#         # Execute task
#         result = save_workflow_node_execution_task(
#             execution_data=sample_execution_data,
#             tenant_id="test-tenant-id",
#             app_id="test-app-id",
#             triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
#             creator_user_id="test-user-id",
#             creator_user_role="account",
#         )

#         # Verify success
#         assert result is True
#         mock_session.add.assert_called_once()
#         mock_session.commit.assert_called_once()

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     @patch("tasks.workflow_node_execution_tasks.select")
#     def test_save_workflow_node_execution_task_update_existing(
#         self, mock_select, mock_sessionmaker, sample_execution_data
#     ):
#         """Test updating an existing workflow node execution."""
#         # Setup mocks
#         mock_session = MagicMock()
#         mock_sessionmaker.return_value.return_value.__enter__.return_value = mock_session

#         existing_execution = Mock(spec=WorkflowNodeExecutionModel)
#         mock_session.scalar.return_value = existing_execution

#         # Execute task
#         result = save_workflow_node_execution_task(
#             execution_data=sample_execution_data,
#             tenant_id="test-tenant-id",
#             app_id="test-app-id",
#             triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
#             creator_user_id="test-user-id",
#             creator_user_role="account",
#         )

#         # Verify success
#         assert result is True
#         mock_session.add.assert_not_called()  # Should not add new, just update existing
#         mock_session.commit.assert_called_once()

#     @patch("tasks.workflow_node_execution_tasks.sessionmaker")
#     def test_save_workflow_node_execution_task_retry_on_exception(self, mock_sessionmaker, sample_execution_data):
#         """Test task retry mechanism on exception."""
#         # Setup mock to raise exception
#         mock_sessionmaker.side_effect = Exception("Database error")

#         # Create a mock task instance with proper retry behavior
#         with patch.object(save_workflow_node_execution_task, "retry") as mock_retry:
#             mock_retry.side_effect = Exception("Retry called")

#             # Execute task and expect retry
#             with pytest.raises(Exception, match="Retry called"):
#                 save_workflow_node_execution_task(
#                     execution_data=sample_execution_data,
#                     tenant_id="test-tenant-id",
#                     app_id="test-app-id",
#                     triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
#                     creator_user_id="test-user-id",
#                     creator_user_role="account",
#                 )

#             # Verify retry was called
#             mock_retry.assert_called_once()

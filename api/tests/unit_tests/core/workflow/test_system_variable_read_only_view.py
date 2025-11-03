from typing import cast

import pytest

from core.file.models import File, FileTransferMethod, FileType
from core.workflow.system_variable import SystemVariable, SystemVariableReadOnlyView


class TestSystemVariableReadOnlyView:
    """Test cases for SystemVariableReadOnlyView class."""

    def test_read_only_property_access(self):
        """Test that all properties return correct values from wrapped instance."""
        # Create test data
        test_file = File(
            id="file-123",
            tenant_id="tenant-123",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related-123",
        )

        datasource_info = {"key": "value", "nested": {"data": 42}}

        # Create SystemVariable with all fields
        system_var = SystemVariable(
            user_id="user-123",
            app_id="app-123",
            workflow_id="workflow-123",
            files=[test_file],
            workflow_execution_id="exec-123",
            query="test query",
            conversation_id="conv-123",
            dialogue_count=5,
            document_id="doc-123",
            original_document_id="orig-doc-123",
            dataset_id="dataset-123",
            batch="batch-123",
            datasource_type="type-123",
            datasource_info=datasource_info,
            invoke_from="invoke-123",
        )

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test all properties
        assert read_only_view.user_id == "user-123"
        assert read_only_view.app_id == "app-123"
        assert read_only_view.workflow_id == "workflow-123"
        assert read_only_view.workflow_execution_id == "exec-123"
        assert read_only_view.query == "test query"
        assert read_only_view.conversation_id == "conv-123"
        assert read_only_view.dialogue_count == 5
        assert read_only_view.document_id == "doc-123"
        assert read_only_view.original_document_id == "orig-doc-123"
        assert read_only_view.dataset_id == "dataset-123"
        assert read_only_view.batch == "batch-123"
        assert read_only_view.datasource_type == "type-123"
        assert read_only_view.invoke_from == "invoke-123"

    def test_defensive_copying_of_mutable_objects(self):
        """Test that mutable objects are defensively copied."""
        # Create test data
        test_file = File(
            id="file-123",
            tenant_id="tenant-123",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related-123",
        )

        datasource_info = {"key": "original_value"}

        # Create SystemVariable
        system_var = SystemVariable(
            files=[test_file], datasource_info=datasource_info, workflow_execution_id="exec-123"
        )

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test files defensive copying
        files_copy = read_only_view.files
        assert isinstance(files_copy, tuple)  # Should be immutable tuple
        assert len(files_copy) == 1
        assert files_copy[0].id == "file-123"

        # Verify it's a copy (can't modify original through view)
        assert isinstance(files_copy, tuple)
        # tuples don't have append method, so they're immutable

        # Test datasource_info defensive copying
        datasource_copy = read_only_view.datasource_info
        assert datasource_copy is not None
        assert datasource_copy["key"] == "original_value"

        datasource_copy = cast(dict, datasource_copy)
        with pytest.raises(TypeError):
            datasource_copy["key"] = "modified value"

        # Verify original is unchanged
        assert system_var.datasource_info is not None
        assert system_var.datasource_info["key"] == "original_value"
        assert read_only_view.datasource_info is not None
        assert read_only_view.datasource_info["key"] == "original_value"

    def test_always_accesses_latest_data(self):
        """Test that properties always return the latest data from wrapped instance."""
        # Create SystemVariable
        system_var = SystemVariable(user_id="original-user", workflow_execution_id="exec-123")

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Verify initial value
        assert read_only_view.user_id == "original-user"

        # Modify the wrapped instance
        system_var.user_id = "modified-user"

        # Verify view returns the new value
        assert read_only_view.user_id == "modified-user"

    def test_repr_method(self):
        """Test the __repr__ method."""
        # Create SystemVariable
        system_var = SystemVariable(workflow_execution_id="exec-123")

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test repr
        repr_str = repr(read_only_view)
        assert "SystemVariableReadOnlyView" in repr_str
        assert "system_variable=" in repr_str

    def test_none_value_handling(self):
        """Test that None values are properly handled."""
        # Create SystemVariable with all None values except workflow_execution_id
        system_var = SystemVariable(
            user_id=None,
            app_id=None,
            workflow_id=None,
            workflow_execution_id="exec-123",
            query=None,
            conversation_id=None,
            dialogue_count=None,
            document_id=None,
            original_document_id=None,
            dataset_id=None,
            batch=None,
            datasource_type=None,
            datasource_info=None,
            invoke_from=None,
        )

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test all None values
        assert read_only_view.user_id is None
        assert read_only_view.app_id is None
        assert read_only_view.workflow_id is None
        assert read_only_view.query is None
        assert read_only_view.conversation_id is None
        assert read_only_view.dialogue_count is None
        assert read_only_view.document_id is None
        assert read_only_view.original_document_id is None
        assert read_only_view.dataset_id is None
        assert read_only_view.batch is None
        assert read_only_view.datasource_type is None
        assert read_only_view.datasource_info is None
        assert read_only_view.invoke_from is None

        # files should be empty tuple even when default list is empty
        assert read_only_view.files == ()

    def test_empty_files_handling(self):
        """Test that empty files list is handled correctly."""
        # Create SystemVariable with empty files
        system_var = SystemVariable(files=[], workflow_execution_id="exec-123")

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test files handling
        assert read_only_view.files == ()
        assert isinstance(read_only_view.files, tuple)

    def test_empty_datasource_info_handling(self):
        """Test that empty datasource_info is handled correctly."""
        # Create SystemVariable with empty datasource_info
        system_var = SystemVariable(datasource_info={}, workflow_execution_id="exec-123")

        # Create read-only view
        read_only_view = SystemVariableReadOnlyView(system_var)

        # Test datasource_info handling
        assert read_only_view.datasource_info == {}
        # Should be a copy, not the same object
        assert read_only_view.datasource_info is not system_var.datasource_info

"""Simplified unit tests for DraftVarLoader focusing on core functionality."""

import json
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Engine

from core.variables.segments import ObjectSegment, StringSegment
from core.variables.types import SegmentType
from models.model import UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import DraftVarLoader


class TestDraftVarLoaderSimple:
    """Simplified unit tests for DraftVarLoader core methods."""

    @pytest.fixture
    def mock_engine(self) -> Engine:
        return Mock(spec=Engine)

    @pytest.fixture
    def draft_var_loader(self, mock_engine):
        """Create DraftVarLoader instance for testing."""
        return DraftVarLoader(
            engine=mock_engine, app_id="test-app-id", tenant_id="test-tenant-id", fallback_variables=[]
        )

    def test_load_offloaded_variable_string_type_unit(self, draft_var_loader):
        """Test _load_offloaded_variable with string type - isolated unit test."""
        # Create mock objects
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/test.txt"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.STRING
        variable_file.upload_file = upload_file

        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.id = "draft-var-id"
        draft_var.node_id = "test-node-id"
        draft_var.name = "test_variable"
        draft_var.description = "test description"
        draft_var.get_selector.return_value = ["test-node-id", "test_variable"]
        draft_var.variable_file = variable_file

        test_content = "This is the full string content"

        with patch("services.workflow_draft_variable_service.storage") as mock_storage:
            mock_storage.load.return_value = test_content.encode()

            with patch("factories.variable_factory.segment_to_variable") as mock_segment_to_variable:
                mock_variable = Mock()
                mock_variable.id = "draft-var-id"
                mock_variable.name = "test_variable"
                mock_variable.value = StringSegment(value=test_content)
                mock_segment_to_variable.return_value = mock_variable

                # Execute the method
                selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                # Verify results
                assert selector_tuple == ("test-node-id", "test_variable")
                assert variable.id == "draft-var-id"
                assert variable.name == "test_variable"
                assert variable.description == "test description"
                assert variable.value == test_content

                # Verify storage was called correctly
                mock_storage.load.assert_called_once_with("storage/key/test.txt")

    def test_load_offloaded_variable_object_type_unit(self, draft_var_loader):
        """Test _load_offloaded_variable with object type - isolated unit test."""
        # Create mock objects
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/test.json"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.OBJECT
        variable_file.upload_file = upload_file

        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.id = "draft-var-id"
        draft_var.node_id = "test-node-id"
        draft_var.name = "test_object"
        draft_var.description = "test description"
        draft_var.get_selector.return_value = ["test-node-id", "test_object"]
        draft_var.variable_file = variable_file

        test_object = {"key1": "value1", "key2": 42}
        test_json_content = json.dumps(test_object, ensure_ascii=False, separators=(",", ":"))

        with patch("services.workflow_draft_variable_service.storage") as mock_storage:
            mock_storage.load.return_value = test_json_content.encode()

            with patch.object(WorkflowDraftVariable, "build_segment_with_type") as mock_build_segment:
                mock_segment = ObjectSegment(value=test_object)
                mock_build_segment.return_value = mock_segment

                with patch("factories.variable_factory.segment_to_variable") as mock_segment_to_variable:
                    mock_variable = Mock()
                    mock_variable.id = "draft-var-id"
                    mock_variable.name = "test_object"
                    mock_variable.value = mock_segment
                    mock_segment_to_variable.return_value = mock_variable

                    # Execute the method
                    selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                    # Verify results
                    assert selector_tuple == ("test-node-id", "test_object")
                    assert variable.id == "draft-var-id"
                    assert variable.name == "test_object"
                    assert variable.description == "test description"
                    assert variable.value == test_object

                    # Verify method calls
                    mock_storage.load.assert_called_once_with("storage/key/test.json")
                    mock_build_segment.assert_called_once_with(SegmentType.OBJECT, test_object)

    def test_load_offloaded_variable_missing_variable_file_unit(self, draft_var_loader):
        """Test that assertion error is raised when variable_file is None."""
        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.variable_file = None

        with pytest.raises(AssertionError):
            draft_var_loader._load_offloaded_variable(draft_var)

    def test_load_offloaded_variable_missing_upload_file_unit(self, draft_var_loader):
        """Test that assertion error is raised when upload_file is None."""
        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.upload_file = None

        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.variable_file = variable_file

        with pytest.raises(AssertionError):
            draft_var_loader._load_offloaded_variable(draft_var)

    def test_load_variables_empty_selectors_unit(self, draft_var_loader):
        """Test load_variables returns empty list for empty selectors."""
        result = draft_var_loader.load_variables([])
        assert result == []

    def test_selector_to_tuple_unit(self, draft_var_loader):
        """Test _selector_to_tuple method."""
        selector = ["node_id", "var_name", "extra_field"]
        result = draft_var_loader._selector_to_tuple(selector)
        assert result == ("node_id", "var_name")

    def test_load_offloaded_variable_number_type_unit(self, draft_var_loader):
        """Test _load_offloaded_variable with number type - isolated unit test."""
        # Create mock objects
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/test_number.json"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.NUMBER
        variable_file.upload_file = upload_file

        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.id = "draft-var-id"
        draft_var.node_id = "test-node-id"
        draft_var.name = "test_number"
        draft_var.description = "test number description"
        draft_var.get_selector.return_value = ["test-node-id", "test_number"]
        draft_var.variable_file = variable_file

        test_number = 123.45
        test_json_content = json.dumps(test_number)

        with patch("services.workflow_draft_variable_service.storage") as mock_storage:
            mock_storage.load.return_value = test_json_content.encode()

            with patch.object(WorkflowDraftVariable, "build_segment_with_type") as mock_build_segment:
                from core.variables.segments import FloatSegment

                mock_segment = FloatSegment(value=test_number)
                mock_build_segment.return_value = mock_segment

                with patch("factories.variable_factory.segment_to_variable") as mock_segment_to_variable:
                    mock_variable = Mock()
                    mock_variable.id = "draft-var-id"
                    mock_variable.name = "test_number"
                    mock_variable.value = mock_segment
                    mock_segment_to_variable.return_value = mock_variable

                    # Execute the method
                    selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                    # Verify results
                    assert selector_tuple == ("test-node-id", "test_number")
                    assert variable.id == "draft-var-id"
                    assert variable.name == "test_number"
                    assert variable.description == "test number description"

                    # Verify method calls
                    mock_storage.load.assert_called_once_with("storage/key/test_number.json")
                    mock_build_segment.assert_called_once_with(SegmentType.NUMBER, test_number)

    def test_load_offloaded_variable_array_type_unit(self, draft_var_loader):
        """Test _load_offloaded_variable with array type - isolated unit test."""
        # Create mock objects
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/test_array.json"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.ARRAY_ANY
        variable_file.upload_file = upload_file

        draft_var = Mock(spec=WorkflowDraftVariable)
        draft_var.id = "draft-var-id"
        draft_var.node_id = "test-node-id"
        draft_var.name = "test_array"
        draft_var.description = "test array description"
        draft_var.get_selector.return_value = ["test-node-id", "test_array"]
        draft_var.variable_file = variable_file

        test_array = ["item1", "item2", "item3"]
        test_json_content = json.dumps(test_array)

        with patch("services.workflow_draft_variable_service.storage") as mock_storage:
            mock_storage.load.return_value = test_json_content.encode()

            with patch.object(WorkflowDraftVariable, "build_segment_with_type") as mock_build_segment:
                from core.variables.segments import ArrayAnySegment

                mock_segment = ArrayAnySegment(value=test_array)
                mock_build_segment.return_value = mock_segment

                with patch("factories.variable_factory.segment_to_variable") as mock_segment_to_variable:
                    mock_variable = Mock()
                    mock_variable.id = "draft-var-id"
                    mock_variable.name = "test_array"
                    mock_variable.value = mock_segment
                    mock_segment_to_variable.return_value = mock_variable

                    # Execute the method
                    selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

                    # Verify results
                    assert selector_tuple == ("test-node-id", "test_array")
                    assert variable.id == "draft-var-id"
                    assert variable.name == "test_array"
                    assert variable.description == "test array description"

                    # Verify method calls
                    mock_storage.load.assert_called_once_with("storage/key/test_array.json")
                    mock_build_segment.assert_called_once_with(SegmentType.ARRAY_ANY, test_array)

    def test_load_variables_with_offloaded_variables_unit(self, draft_var_loader):
        """Test load_variables method with mix of regular and offloaded variables."""
        selectors = [["node1", "regular_var"], ["node2", "offloaded_var"]]

        # Mock regular variable
        regular_draft_var = Mock(spec=WorkflowDraftVariable)
        regular_draft_var.is_truncated.return_value = False
        regular_draft_var.node_id = "node1"
        regular_draft_var.name = "regular_var"
        regular_draft_var.get_value.return_value = StringSegment(value="regular_value")
        regular_draft_var.get_selector.return_value = ["node1", "regular_var"]
        regular_draft_var.id = "regular-var-id"
        regular_draft_var.description = "regular description"

        # Mock offloaded variable
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/offloaded.txt"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.STRING
        variable_file.upload_file = upload_file

        offloaded_draft_var = Mock(spec=WorkflowDraftVariable)
        offloaded_draft_var.is_truncated.return_value = True
        offloaded_draft_var.node_id = "node2"
        offloaded_draft_var.name = "offloaded_var"
        offloaded_draft_var.get_selector.return_value = ["node2", "offloaded_var"]
        offloaded_draft_var.variable_file = variable_file
        offloaded_draft_var.id = "offloaded-var-id"
        offloaded_draft_var.description = "offloaded description"

        draft_vars = [regular_draft_var, offloaded_draft_var]

        with patch("services.workflow_draft_variable_service.Session") as mock_session_cls:
            mock_session = Mock()
            mock_session_cls.return_value.__enter__.return_value = mock_session

            mock_service = Mock()
            mock_service.get_draft_variables_by_selectors.return_value = draft_vars

            with patch(
                "services.workflow_draft_variable_service.WorkflowDraftVariableService", return_value=mock_service
            ):
                with patch("services.workflow_draft_variable_service.StorageKeyLoader"):
                    with patch("factories.variable_factory.segment_to_variable") as mock_segment_to_variable:
                        # Mock regular variable creation
                        regular_variable = Mock()
                        regular_variable.selector = ["node1", "regular_var"]

                        # Mock offloaded variable creation
                        offloaded_variable = Mock()
                        offloaded_variable.selector = ["node2", "offloaded_var"]

                        mock_segment_to_variable.return_value = regular_variable

                        with patch("services.workflow_draft_variable_service.storage") as mock_storage:
                            mock_storage.load.return_value = b"offloaded_content"

                            with patch.object(draft_var_loader, "_load_offloaded_variable") as mock_load_offloaded:
                                mock_load_offloaded.return_value = (("node2", "offloaded_var"), offloaded_variable)

                                with patch("concurrent.futures.ThreadPoolExecutor") as mock_executor_cls:
                                    mock_executor = Mock()
                                    mock_executor_cls.return_value.__enter__.return_value = mock_executor
                                    mock_executor.map.return_value = [(("node2", "offloaded_var"), offloaded_variable)]

                                    # Execute the method
                                    result = draft_var_loader.load_variables(selectors)

                                    # Verify results
                                    assert len(result) == 2

                                    # Verify service method was called
                                    mock_service.get_draft_variables_by_selectors.assert_called_once_with(
                                        draft_var_loader._app_id, selectors
                                    )

                                    # Verify offloaded variable loading was called
                                    mock_load_offloaded.assert_called_once_with(offloaded_draft_var)

    def test_load_variables_all_offloaded_variables_unit(self, draft_var_loader):
        """Test load_variables method with only offloaded variables."""
        selectors = [["node1", "offloaded_var1"], ["node2", "offloaded_var2"]]

        # Mock first offloaded variable
        offloaded_var1 = Mock(spec=WorkflowDraftVariable)
        offloaded_var1.is_truncated.return_value = True
        offloaded_var1.node_id = "node1"
        offloaded_var1.name = "offloaded_var1"

        # Mock second offloaded variable
        offloaded_var2 = Mock(spec=WorkflowDraftVariable)
        offloaded_var2.is_truncated.return_value = True
        offloaded_var2.node_id = "node2"
        offloaded_var2.name = "offloaded_var2"

        draft_vars = [offloaded_var1, offloaded_var2]

        with patch("services.workflow_draft_variable_service.Session") as mock_session_cls:
            mock_session = Mock()
            mock_session_cls.return_value.__enter__.return_value = mock_session

            mock_service = Mock()
            mock_service.get_draft_variables_by_selectors.return_value = draft_vars

            with patch(
                "services.workflow_draft_variable_service.WorkflowDraftVariableService", return_value=mock_service
            ):
                with patch("services.workflow_draft_variable_service.StorageKeyLoader"):
                    with patch("services.workflow_draft_variable_service.ThreadPoolExecutor") as mock_executor_cls:
                        mock_executor = Mock()
                        mock_executor_cls.return_value.__enter__.return_value = mock_executor
                        mock_executor.map.return_value = [
                            (("node1", "offloaded_var1"), Mock()),
                            (("node2", "offloaded_var2"), Mock()),
                        ]

                        # Execute the method
                        result = draft_var_loader.load_variables(selectors)

                        # Verify results - since we have only offloaded variables, should have 2 results
                        assert len(result) == 2

                        # Verify ThreadPoolExecutor was used
                        mock_executor_cls.assert_called_once_with(max_workers=10)
                        mock_executor.map.assert_called_once()

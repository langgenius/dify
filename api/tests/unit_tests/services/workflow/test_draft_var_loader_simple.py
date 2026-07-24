"""Simplified unit tests for DraftVarLoader focusing on core functionality."""

import json
from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from extensions.storage.storage_type import StorageType
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import ObjectSegment, StringSegment
from graphon.variables.types import SegmentType
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile
from services.workflow_draft_variable_service import DraftVarLoader


def _persist_offloaded_variable(
    sqlite_session: Session,
    *,
    node_id: str,
    name: str,
) -> WorkflowDraftVariable:
    upload_file = UploadFile(
        tenant_id="test-tenant-id",
        storage_type=StorageType.LOCAL,
        key=f"storage/key/{name}.txt",
        name=f"{name}.txt",
        size=10,
        extension=".txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="test-user-id",
        created_at=datetime(2025, 1, 1),
        used=True,
    )
    variable_file = WorkflowDraftVariableFile(
        tenant_id="test-tenant-id",
        app_id="test-app-id",
        user_id="test-user-id",
        upload_file_id=upload_file.id,
        size=10,
        length=None,
        value_type=SegmentType.STRING,
    )
    draft_variable = WorkflowDraftVariable.new_node_variable(
        app_id="test-app-id",
        user_id="test-user-id",
        node_id=node_id,
        name=name,
        value=StringSegment(value="truncated"),
        node_execution_id=f"execution-{node_id}",
        file_id=variable_file.id,
    )
    sqlite_session.add_all([upload_file, variable_file, draft_variable])
    return draft_variable


class TestDraftVarLoaderSimple:
    """Simplified unit tests for DraftVarLoader core methods."""

    @pytest.fixture
    def draft_var_loader(self, sqlite_engine: Engine):
        """Create DraftVarLoader instance for testing."""
        return DraftVarLoader(
            engine=sqlite_engine,
            app_id="test-app-id",
            tenant_id="test-tenant-id",
            user_id="test-user-id",
            fallback_variables=[],
        )

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
            mock_segment = ObjectSegment(value=test_object)
            draft_var.build_segment_from_serialized_value.return_value = mock_segment

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
            draft_var.build_segment_from_serialized_value.assert_called_once_with(SegmentType.OBJECT, test_object)

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
            from graphon.variables.segments import ArrayAnySegment

            mock_segment = ArrayAnySegment(value=test_array)
            draft_var.build_segment_from_serialized_value.return_value = mock_segment

            # Execute the method
            selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

            # Verify results
            assert selector_tuple == ("test-node-id", "test_array")
            assert variable.id == "draft-var-id"
            assert variable.name == "test_array"
            assert variable.description == "test array description"

            # Verify method calls
            mock_storage.load.assert_called_once_with("storage/key/test_array.json")
            draft_var.build_segment_from_serialized_value.assert_called_once_with(SegmentType.ARRAY_ANY, test_array)

    def test_load_offloaded_variable_file_type_rebuilds_storage_backed_payload(self, draft_var_loader):
        upload_file = Mock(spec=UploadFile)
        upload_file.key = "storage/key/test_file.json"

        variable_file = Mock(spec=WorkflowDraftVariableFile)
        variable_file.value_type = SegmentType.FILE
        variable_file.upload_file = upload_file

        draft_var = WorkflowDraftVariable(
            id="draft-var-id",
            app_id="app-1",
            node_id="test-node-id",
            name="test_file",
            description="test file description",
        )
        draft_var._set_selector(["test-node-id", "test_file"])
        draft_var.variable_file = variable_file

        persisted_file = File(
            file_id="file-1",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            reference=build_file_reference(record_id="upload-1", storage_key="legacy-storage-key"),
            filename="test.txt",
            extension=".txt",
            mime_type="text/plain",
            size=12,
        )
        rebuilt_file = File(
            file_id="file-1",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            reference=build_file_reference(record_id="upload-1"),
            filename="test.txt",
            extension=".txt",
            mime_type="text/plain",
            size=12,
            storage_key="canonical-storage-key",
        )

        raw_file = {
            **persisted_file.model_dump(mode="json"),
            "tenant_id": "legacy-tenant",
        }

        with (
            patch("services.workflow_draft_variable_service.storage") as mock_storage,
            patch("models.workflow._resolve_workflow_app_tenant_id", return_value="tenant-1"),
            patch("models.workflow.build_file_from_stored_mapping", return_value=rebuilt_file) as rebuild_file,
        ):
            mock_storage.load.return_value = json.dumps(raw_file).encode()

            selector_tuple, variable = draft_var_loader._load_offloaded_variable(draft_var)

        assert selector_tuple == ("test-node-id", "test_file")
        assert variable.id == "draft-var-id"
        assert variable.name == "test_file"
        assert variable.description == "test file description"
        assert variable.value == rebuilt_file
        rebuild_file.assert_called_once_with(file_mapping=raw_file, tenant_id="tenant-1")

    @pytest.mark.parametrize(
        "sqlite_session",
        [(WorkflowDraftVariable, WorkflowDraftVariableFile, UploadFile)],
        indirect=True,
    )
    def test_load_variables_with_offloaded_variables_unit(
        self,
        draft_var_loader: DraftVarLoader,
        sqlite_session: Session,
    ):
        """Test load_variables method with mix of regular and offloaded variables."""
        selectors = [["node1", "regular_var"], ["node2", "offloaded_var"]]
        regular_draft_var = WorkflowDraftVariable.new_node_variable(
            app_id="test-app-id",
            user_id="test-user-id",
            node_id="node1",
            name="regular_var",
            value=StringSegment(value="regular_value"),
            node_execution_id="execution-node1",
        )
        regular_draft_var.description = "regular description"
        offloaded_draft_var = _persist_offloaded_variable(
            sqlite_session,
            node_id="node2",
            name="offloaded_var",
        )
        distractor = WorkflowDraftVariable.new_node_variable(
            app_id="test-app-id",
            user_id="another-user",
            node_id="node1",
            name="regular_var",
            value=StringSegment(value="wrong user"),
            node_execution_id="execution-distractor",
        )
        sqlite_session.add_all([regular_draft_var, distractor])
        sqlite_session.commit()

        offloaded_variable = Mock()
        offloaded_variable.id = offloaded_draft_var.id
        offloaded_variable.selector = ["node2", "offloaded_var"]

        with (
            patch("services.workflow_draft_variable_service.StorageKeyLoader"),
            patch.object(
                draft_var_loader,
                "_load_offloaded_variable",
                return_value=(("node2", "offloaded_var"), offloaded_variable),
            ) as load_offloaded,
            patch("services.workflow_draft_variable_service.ThreadPoolExecutor") as executor_cls,
        ):
            executor = executor_cls.return_value.__enter__.return_value
            executor.map.side_effect = lambda function, values: [function(value) for value in values]

            result = draft_var_loader.load_variables(selectors)

        assert {variable.id for variable in result} == {regular_draft_var.id, offloaded_draft_var.id}
        load_offloaded.assert_called_once()
        loaded_offloaded = load_offloaded.call_args.args[0]
        assert isinstance(loaded_offloaded, WorkflowDraftVariable)
        assert loaded_offloaded.id == offloaded_draft_var.id
        assert loaded_offloaded.variable_file.upload_file.key == "storage/key/offloaded_var.txt"

    @pytest.mark.parametrize(
        "sqlite_session",
        [(WorkflowDraftVariable, WorkflowDraftVariableFile, UploadFile)],
        indirect=True,
    )
    def test_load_variables_all_offloaded_variables_unit(
        self,
        draft_var_loader: DraftVarLoader,
        sqlite_session: Session,
    ):
        """Test load_variables method with only offloaded variables."""
        selectors = [["node1", "offloaded_var1"], ["node2", "offloaded_var2"]]
        offloaded_var1 = _persist_offloaded_variable(
            sqlite_session,
            node_id="node1",
            name="offloaded_var1",
        )
        offloaded_var2 = _persist_offloaded_variable(
            sqlite_session,
            node_id="node2",
            name="offloaded_var2",
        )
        sqlite_session.commit()

        with (
            patch("services.workflow_draft_variable_service.StorageKeyLoader"),
            patch("services.workflow_draft_variable_service.ThreadPoolExecutor") as executor_cls,
        ):
            executor = executor_cls.return_value.__enter__.return_value
            executor.map.return_value = [
                (("node1", "offloaded_var1"), Mock()),
                (("node2", "offloaded_var2"), Mock()),
            ]

            result = draft_var_loader.load_variables(selectors)

        assert len(result) == 2
        executor_cls.assert_called_once_with(max_workers=10)
        executor.map.assert_called_once()
        loaded_draft_vars = executor.map.call_args.args[1]
        assert {variable.id for variable in loaded_draft_vars} == {offloaded_var1.id, offloaded_var2.id}
        assert all(variable.variable_file.upload_file is not None for variable in loaded_draft_vars)

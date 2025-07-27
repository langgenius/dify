import json
from typing import Any

import pytest
from pydantic import ValidationError

from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.workflow.system_variable import SystemVariable

# Test data constants for SystemVariable serialization tests
VALID_BASE_DATA: dict[str, Any] = {
    "user_id": "a20f06b1-8703-45ab-937c-860a60072113",
    "app_id": "661bed75-458d-49c9-b487-fda0762677b9",
    "workflow_id": "d31f2136-b292-4ae0-96d4-1e77894a4f43",
}

COMPLETE_VALID_DATA: dict[str, Any] = {
    **VALID_BASE_DATA,
    "query": "test query",
    "files": [],
    "conversation_id": "91f1eb7d-69f4-4d7b-b82f-4003d51744b9",
    "dialogue_count": 5,
    "workflow_run_id": "eb4704b5-2274-47f2-bfcd-0452daa82cb5",
}


def create_test_file() -> File:
    """Create a test File object for serialization tests."""
    return File(
        tenant_id="test-tenant-id",
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id="test-file-id",
        filename="test.txt",
        extension=".txt",
        mime_type="text/plain",
        size=1024,
        storage_key="test-storage-key",
    )


class TestSystemVariableSerialization:
    """Focused tests for SystemVariable serialization/deserialization logic."""

    def test_basic_deserialization(self):
        """Test successful deserialization from JSON structure with all fields correctly mapped."""
        # Test with complete data
        system_var = SystemVariable(**COMPLETE_VALID_DATA)

        # Verify all fields are correctly mapped
        assert system_var.user_id == COMPLETE_VALID_DATA["user_id"]
        assert system_var.app_id == COMPLETE_VALID_DATA["app_id"]
        assert system_var.workflow_id == COMPLETE_VALID_DATA["workflow_id"]
        assert system_var.query == COMPLETE_VALID_DATA["query"]
        assert system_var.conversation_id == COMPLETE_VALID_DATA["conversation_id"]
        assert system_var.dialogue_count == COMPLETE_VALID_DATA["dialogue_count"]
        assert system_var.workflow_execution_id == COMPLETE_VALID_DATA["workflow_run_id"]
        assert system_var.files == []

        # Test with minimal data (only required fields)
        minimal_var = SystemVariable(**VALID_BASE_DATA)
        assert minimal_var.user_id == VALID_BASE_DATA["user_id"]
        assert minimal_var.app_id == VALID_BASE_DATA["app_id"]
        assert minimal_var.workflow_id == VALID_BASE_DATA["workflow_id"]
        assert minimal_var.query is None
        assert minimal_var.conversation_id is None
        assert minimal_var.dialogue_count is None
        assert minimal_var.workflow_execution_id is None
        assert minimal_var.files == []

    def test_alias_handling(self):
        """Test workflow_execution_id vs workflow_run_id alias resolution - core deserialization logic."""
        workflow_id = "eb4704b5-2274-47f2-bfcd-0452daa82cb5"

        # Test workflow_run_id only (preferred alias)
        data_run_id = {**VALID_BASE_DATA, "workflow_run_id": workflow_id}
        system_var1 = SystemVariable(**data_run_id)
        assert system_var1.workflow_execution_id == workflow_id

        # Test workflow_execution_id only (direct field name)
        data_execution_id = {**VALID_BASE_DATA, "workflow_execution_id": workflow_id}
        system_var2 = SystemVariable(**data_execution_id)
        assert system_var2.workflow_execution_id == workflow_id

        # Test both present - workflow_run_id should take precedence
        data_both = {
            **VALID_BASE_DATA,
            "workflow_execution_id": "should-be-ignored",
            "workflow_run_id": workflow_id,
        }
        system_var3 = SystemVariable(**data_both)
        assert system_var3.workflow_execution_id == workflow_id

        # Test neither present - should be None
        system_var4 = SystemVariable(**VALID_BASE_DATA)
        assert system_var4.workflow_execution_id is None

    def test_serialization_round_trip(self):
        """Test that serialize → deserialize produces the same result with alias handling."""
        # Create original SystemVariable
        original = SystemVariable(**COMPLETE_VALID_DATA)

        # Serialize to dict
        serialized = original.model_dump(mode="json")

        # Verify alias is used in serialization (workflow_run_id, not workflow_execution_id)
        assert "workflow_run_id" in serialized
        assert "workflow_execution_id" not in serialized
        assert serialized["workflow_run_id"] == COMPLETE_VALID_DATA["workflow_run_id"]

        # Deserialize back
        deserialized = SystemVariable(**serialized)

        # Verify all fields match after round-trip
        assert deserialized.user_id == original.user_id
        assert deserialized.app_id == original.app_id
        assert deserialized.workflow_id == original.workflow_id
        assert deserialized.query == original.query
        assert deserialized.conversation_id == original.conversation_id
        assert deserialized.dialogue_count == original.dialogue_count
        assert deserialized.workflow_execution_id == original.workflow_execution_id
        assert list(deserialized.files) == list(original.files)

    def test_json_round_trip(self):
        """Test JSON serialization/deserialization consistency with proper structure."""
        # Create original SystemVariable
        original = SystemVariable(**COMPLETE_VALID_DATA)

        # Serialize to JSON string
        json_str = original.model_dump_json()

        # Parse JSON and verify structure
        json_data = json.loads(json_str)
        assert "workflow_run_id" in json_data
        assert "workflow_execution_id" not in json_data
        assert json_data["workflow_run_id"] == COMPLETE_VALID_DATA["workflow_run_id"]

        # Deserialize from JSON data
        deserialized = SystemVariable(**json_data)

        # Verify key fields match after JSON round-trip
        assert deserialized.workflow_execution_id == original.workflow_execution_id
        assert deserialized.user_id == original.user_id
        assert deserialized.app_id == original.app_id
        assert deserialized.workflow_id == original.workflow_id

    def test_files_field_deserialization(self):
        """Test deserialization with File objects in the files field - SystemVariable specific logic."""
        # Test with empty files list
        data_empty = {**VALID_BASE_DATA, "files": []}
        system_var_empty = SystemVariable(**data_empty)
        assert system_var_empty.files == []

        # Test with single File object
        test_file = create_test_file()
        data_single = {**VALID_BASE_DATA, "files": [test_file]}
        system_var_single = SystemVariable(**data_single)
        assert len(system_var_single.files) == 1
        assert system_var_single.files[0].filename == "test.txt"
        assert system_var_single.files[0].tenant_id == "test-tenant-id"

        # Test with multiple File objects
        file1 = File(
            tenant_id="tenant1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="file1",
            filename="doc1.txt",
            storage_key="key1",
        )
        file2 = File(
            tenant_id="tenant2",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/image.jpg",
            filename="image.jpg",
            storage_key="key2",
        )

        data_multiple = {**VALID_BASE_DATA, "files": [file1, file2]}
        system_var_multiple = SystemVariable(**data_multiple)
        assert len(system_var_multiple.files) == 2
        assert system_var_multiple.files[0].filename == "doc1.txt"
        assert system_var_multiple.files[1].filename == "image.jpg"

        # Verify files field serialization/deserialization
        serialized = system_var_multiple.model_dump(mode="json")
        deserialized = SystemVariable(**serialized)
        assert len(deserialized.files) == 2
        assert deserialized.files[0].filename == "doc1.txt"
        assert deserialized.files[1].filename == "image.jpg"

    def test_alias_serialization_consistency(self):
        """Test that alias handling works consistently in both serialization directions."""
        workflow_id = "test-workflow-id"

        # Create with workflow_run_id (alias)
        data_with_alias = {**VALID_BASE_DATA, "workflow_run_id": workflow_id}
        system_var = SystemVariable(**data_with_alias)

        # Serialize and verify alias is used
        serialized = system_var.model_dump()
        assert serialized["workflow_run_id"] == workflow_id
        assert "workflow_execution_id" not in serialized

        # Deserialize and verify field mapping
        deserialized = SystemVariable(**serialized)
        assert deserialized.workflow_execution_id == workflow_id

        # Test JSON serialization path
        json_serialized = json.loads(system_var.model_dump_json())
        assert json_serialized["workflow_run_id"] == workflow_id
        assert "workflow_execution_id" not in json_serialized

        json_deserialized = SystemVariable(**json_serialized)
        assert json_deserialized.workflow_execution_id == workflow_id

    def test_model_validator_serialization_logic(self):
        """Test the custom model validator behavior for serialization scenarios."""
        workflow_id = "test-workflow-execution-id"

        # Test direct instantiation with workflow_execution_id (should work)
        data1 = {**VALID_BASE_DATA, "workflow_execution_id": workflow_id}
        system_var1 = SystemVariable(**data1)
        assert system_var1.workflow_execution_id == workflow_id

        # Test serialization of the above (should use alias)
        serialized1 = system_var1.model_dump()
        assert "workflow_run_id" in serialized1
        assert serialized1["workflow_run_id"] == workflow_id

        # Test both present - workflow_run_id takes precedence (validator logic)
        data2 = {
            **VALID_BASE_DATA,
            "workflow_execution_id": "should-be-removed",
            "workflow_run_id": workflow_id,
        }
        system_var2 = SystemVariable(**data2)
        assert system_var2.workflow_execution_id == workflow_id

        # Verify serialization consistency
        serialized2 = system_var2.model_dump()
        assert serialized2["workflow_run_id"] == workflow_id


def test_constructor_with_extra_key():
    # Test that SystemVariable should forbid extra keys
    with pytest.raises(ValidationError):
        # This should fail because there is an unexpected key.
        SystemVariable(invalid_key=1)  # type: ignore

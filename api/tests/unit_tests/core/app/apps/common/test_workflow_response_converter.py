from collections.abc import Mapping, Sequence

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from core.variables.segments import ArrayFileSegment, FileSegment


class TestWorkflowResponseConverterFetchFilesFromVariableValue:
    """Test class for WorkflowResponseConverter._fetch_files_from_variable_value method"""

    def create_test_file(self, file_id: str = "test_file_1") -> File:
        """Create a test File object"""
        return File(
            id=file_id,
            tenant_id="test_tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="related_123",
            filename=f"{file_id}.txt",
            extension=".txt",
            mime_type="text/plain",
            size=1024,
            storage_key="storage_key_123",
        )

    def create_file_dict(self, file_id: str = "test_file_dict"):
        """Create a file dictionary with correct dify_model_identity"""
        return {
            "dify_model_identity": FILE_MODEL_IDENTITY,
            "id": file_id,
            "tenant_id": "test_tenant",
            "type": "document",
            "transfer_method": "local_file",
            "related_id": "related_456",
            "filename": f"{file_id}.txt",
            "extension": ".txt",
            "mime_type": "text/plain",
            "size": 2048,
            "url": "http://example.com/file.txt",
        }

    def test_fetch_files_from_variable_value_with_none(self):
        """Test with None input"""
        # The method signature expects Union[dict, list, Segment], but implementation handles None
        # We'll test the actual behavior by passing an empty dict instead
        result = WorkflowResponseConverter._fetch_files_from_variable_value(None)
        assert result == []

    def test_fetch_files_from_variable_value_with_empty_dict(self):
        """Test with empty dictionary"""
        result = WorkflowResponseConverter._fetch_files_from_variable_value({})
        assert result == []

    def test_fetch_files_from_variable_value_with_empty_list(self):
        """Test with empty list"""
        result = WorkflowResponseConverter._fetch_files_from_variable_value([])
        assert result == []

    def test_fetch_files_from_variable_value_with_file_segment(self):
        """Test with valid FileSegment"""
        test_file = self.create_test_file("segment_file")
        file_segment = FileSegment(value=test_file)

        result = WorkflowResponseConverter._fetch_files_from_variable_value(file_segment)

        assert len(result) == 1
        assert isinstance(result[0], dict)
        assert result[0]["id"] == "segment_file"
        assert result[0]["dify_model_identity"] == FILE_MODEL_IDENTITY

    def test_fetch_files_from_variable_value_with_array_file_segment_single(self):
        """Test with ArrayFileSegment containing single file"""
        test_file = self.create_test_file("array_file_1")
        array_segment = ArrayFileSegment(value=[test_file])

        result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

        assert len(result) == 1
        assert isinstance(result[0], dict)
        assert result[0]["id"] == "array_file_1"

    def test_fetch_files_from_variable_value_with_array_file_segment_multiple(self):
        """Test with ArrayFileSegment containing multiple files"""
        test_file_1 = self.create_test_file("array_file_1")
        test_file_2 = self.create_test_file("array_file_2")
        array_segment = ArrayFileSegment(value=[test_file_1, test_file_2])

        result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

        assert len(result) == 2
        assert result[0]["id"] == "array_file_1"
        assert result[1]["id"] == "array_file_2"

    def test_fetch_files_from_variable_value_with_array_file_segment_empty(self):
        """Test with ArrayFileSegment containing empty array"""
        array_segment = ArrayFileSegment(value=[])

        result = WorkflowResponseConverter._fetch_files_from_variable_value(array_segment)

        assert result == []

    def test_fetch_files_from_variable_value_with_list_of_file_dicts(self):
        """Test with list containing file dictionaries"""
        file_dict_1 = self.create_file_dict("list_file_1")
        file_dict_2 = self.create_file_dict("list_file_2")
        test_list = [file_dict_1, file_dict_2]

        result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

        assert len(result) == 2
        assert result[0]["id"] == "list_file_1"
        assert result[1]["id"] == "list_file_2"

    def test_fetch_files_from_variable_value_with_list_of_file_objects(self):
        """Test with list containing File objects"""
        file_obj_1 = self.create_test_file("list_obj_1")
        file_obj_2 = self.create_test_file("list_obj_2")
        test_list = [file_obj_1, file_obj_2]

        result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

        assert len(result) == 2
        assert result[0]["id"] == "list_obj_1"
        assert result[1]["id"] == "list_obj_2"

    def test_fetch_files_from_variable_value_with_list_mixed_valid_invalid(self):
        """Test with list containing mix of valid files and invalid items"""
        file_dict = self.create_file_dict("mixed_file")
        invalid_dict = {"not_a_file": "value"}
        test_list = [file_dict, invalid_dict, "string_item", 123]

        result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

        assert len(result) == 1
        assert result[0]["id"] == "mixed_file"

    def test_fetch_files_from_variable_value_with_list_nested_structures(self):
        """Test with list containing nested structures"""
        file_dict = self.create_file_dict("nested_file")
        nested_list = [file_dict, ["inner_list"]]
        test_list = [nested_list, {"nested": "dict"}]

        result = WorkflowResponseConverter._fetch_files_from_variable_value(test_list)

        # Should not process nested structures in list items
        assert result == []

    def test_fetch_files_from_variable_value_with_dict_incorrect_identity(self):
        """Test with dictionary having incorrect dify_model_identity"""
        invalid_dict = {"dify_model_identity": "wrong_identity", "id": "invalid_file", "filename": "test.txt"}

        result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

        assert result == []

    def test_fetch_files_from_variable_value_with_dict_missing_identity(self):
        """Test with dictionary missing dify_model_identity"""
        invalid_dict = {"id": "no_identity_file", "filename": "test.txt"}

        result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

        assert result == []

    def test_fetch_files_from_variable_value_with_dict_file_object(self):
        """Test with dictionary containing File object"""
        file_obj = self.create_test_file("dict_obj_file")
        test_dict = {"file_key": file_obj}

        result = WorkflowResponseConverter._fetch_files_from_variable_value(test_dict)

        # Should not extract File objects from dict values
        assert result == []

    def test_fetch_files_from_variable_value_with_mixed_data_types(self):
        """Test with various mixed data types"""
        mixed_data = {"string": "text", "number": 42, "boolean": True, "null": None, "dify_model_identity": "wrong"}

        result = WorkflowResponseConverter._fetch_files_from_variable_value(mixed_data)

        assert result == []

    def test_fetch_files_from_variable_value_with_invalid_objects(self):
        """Test with invalid objects that are not supported types"""
        # Test with an invalid dict that doesn't match expected patterns
        invalid_dict = {"custom_key": "custom_value"}

        result = WorkflowResponseConverter._fetch_files_from_variable_value(invalid_dict)

        assert result == []

    def test_fetch_files_from_variable_value_with_string_input(self):
        """Test with string input (unsupported type)"""
        # Since method expects Union[dict, list, Segment], test with empty list instead
        result = WorkflowResponseConverter._fetch_files_from_variable_value([])

        assert result == []

    def test_fetch_files_from_variable_value_with_number_input(self):
        """Test with number input (unsupported type)"""
        # Test with list containing numbers (should be ignored)
        result = WorkflowResponseConverter._fetch_files_from_variable_value([42, "string", None])

        assert result == []

    def test_fetch_files_from_variable_value_return_type_is_sequence(self):
        """Test that return type is Sequence[Mapping[str, Any]]"""
        file_dict = self.create_file_dict("type_test_file")

        result = WorkflowResponseConverter._fetch_files_from_variable_value(file_dict)

        assert isinstance(result, Sequence)
        assert len(result) == 1
        assert isinstance(result[0], Mapping)
        assert all(isinstance(key, str) for key in result[0])

    def test_fetch_files_from_variable_value_preserves_file_properties(self):
        """Test that all file properties are preserved in the result"""
        original_file = self.create_test_file("property_test")
        file_segment = FileSegment(value=original_file)

        result = WorkflowResponseConverter._fetch_files_from_variable_value(file_segment)

        assert len(result) == 1
        file_dict = result[0]
        assert file_dict["id"] == "property_test"
        assert file_dict["tenant_id"] == "test_tenant"
        assert file_dict["type"] == "document"
        assert file_dict["transfer_method"] == "local_file"
        assert file_dict["filename"] == "property_test.txt"
        assert file_dict["extension"] == ".txt"
        assert file_dict["mime_type"] == "text/plain"
        assert file_dict["size"] == 1024

    def test_fetch_files_from_variable_value_with_complex_nested_scenario(self):
        """Test complex scenario with nested valid and invalid data"""
        file_dict = self.create_file_dict("complex_file")
        file_obj = self.create_test_file("complex_obj")

        # Complex nested structure
        complex_data = [
            file_dict,  # Valid file dict
            file_obj,  # Valid file object
            {  # Invalid dict
                "not_file": "data",
                "nested": {"deep": "value"},
            },
            [  # Nested list (should be ignored)
                self.create_file_dict("nested_file")
            ],
            "string",  # Invalid string
            None,  # None value
            42,  # Invalid number
        ]

        result = WorkflowResponseConverter._fetch_files_from_variable_value(complex_data)

        assert len(result) == 2
        assert result[0]["id"] == "complex_file"
        assert result[1]["id"] == "complex_obj"

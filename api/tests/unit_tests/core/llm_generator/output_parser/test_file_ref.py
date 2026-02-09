"""
Unit tests for file reference detection and conversion.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from core.file import File, FileTransferMethod, FileType
from core.llm_generator.output_parser.file_ref import (
    FILE_REF_FORMAT,
    convert_file_refs_in_output,
    detect_file_ref_fields,
    is_file_ref_property,
)
from core.variables.segments import ArrayFileSegment, FileSegment


class TestIsFileRefProperty:
    """Tests for is_file_ref_property function."""

    def test_valid_file_ref(self):
        schema = {"type": "string", "format": FILE_REF_FORMAT}
        assert is_file_ref_property(schema) is True

    def test_invalid_type(self):
        schema = {"type": "number", "format": FILE_REF_FORMAT}
        assert is_file_ref_property(schema) is False

    def test_missing_format(self):
        schema = {"type": "string"}
        assert is_file_ref_property(schema) is False

    def test_wrong_format(self):
        schema = {"type": "string", "format": "uuid"}
        assert is_file_ref_property(schema) is False


class TestDetectFileRefFields:
    """Tests for detect_file_ref_fields function."""

    def test_simple_file_ref(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
            },
        }
        paths = detect_file_ref_fields(schema)
        assert paths == ["image"]

    def test_multiple_file_refs(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
                "document": {"type": "string", "format": FILE_REF_FORMAT},
                "name": {"type": "string"},
            },
        }
        paths = detect_file_ref_fields(schema)
        assert set(paths) == {"image", "document"}

    def test_array_of_file_refs(self):
        schema = {
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": {"type": "string", "format": FILE_REF_FORMAT},
                },
            },
        }
        paths = detect_file_ref_fields(schema)
        assert paths == ["files[*]"]

    def test_nested_file_ref(self):
        schema = {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                    "properties": {
                        "image": {"type": "string", "format": FILE_REF_FORMAT},
                    },
                },
            },
        }
        paths = detect_file_ref_fields(schema)
        assert paths == ["data.image"]

    def test_no_file_refs(self):
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "number"},
            },
        }
        paths = detect_file_ref_fields(schema)
        assert paths == []

    def test_empty_schema(self):
        schema = {}
        paths = detect_file_ref_fields(schema)
        assert paths == []

    def test_mixed_schema(self):
        schema = {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "image": {"type": "string", "format": FILE_REF_FORMAT},
                "documents": {
                    "type": "array",
                    "items": {"type": "string", "format": FILE_REF_FORMAT},
                },
            },
        }
        paths = detect_file_ref_fields(schema)
        assert set(paths) == {"image", "documents[*]"}


class TestConvertFileRefsInOutput:
    """Tests for convert_file_refs_in_output function."""

    @pytest.fixture
    def mock_file(self):
        """Create a mock File object with all required attributes."""
        file = MagicMock(spec=File)
        file.type = FileType.IMAGE
        file.transfer_method = FileTransferMethod.TOOL_FILE
        file.related_id = "test-related-id"
        file.remote_url = None
        file.tenant_id = "tenant_123"
        file.id = None
        file.filename = "test.png"
        file.extension = ".png"
        file.mime_type = "image/png"
        file.size = 1024
        file.dify_model_identity = "__dify__file__"
        return file

    @pytest.fixture
    def mock_build_from_mapping(self, mock_file):
        """Mock the build_from_mapping function."""
        with patch("core.llm_generator.output_parser.file_ref.build_from_mapping") as mock:
            mock.return_value = mock_file
            yield mock

    def test_convert_simple_file_ref(self, mock_build_from_mapping, mock_file):
        file_id = str(uuid.uuid4())
        output = {"image": file_id}
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
            },
        }

        result = convert_file_refs_in_output(output, schema, "tenant_123")

        # Result should be wrapped in FileSegment
        assert isinstance(result["image"], FileSegment)
        assert result["image"].value == mock_file
        mock_build_from_mapping.assert_called_once_with(
            mapping={"transfer_method": "tool_file", "tool_file_id": file_id},
            tenant_id="tenant_123",
        )

    def test_convert_array_of_file_refs(self, mock_build_from_mapping, mock_file):
        file_id1 = str(uuid.uuid4())
        file_id2 = str(uuid.uuid4())
        output = {"files": [file_id1, file_id2]}
        schema = {
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": {"type": "string", "format": FILE_REF_FORMAT},
                },
            },
        }

        result = convert_file_refs_in_output(output, schema, "tenant_123")

        # Result should be wrapped in ArrayFileSegment
        assert isinstance(result["files"], ArrayFileSegment)
        assert list(result["files"].value) == [mock_file, mock_file]
        assert mock_build_from_mapping.call_count == 2

    def test_no_conversion_without_file_refs(self):
        output = {"name": "test", "count": 5}
        schema = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "number"},
            },
        }

        result = convert_file_refs_in_output(output, schema, "tenant_123")

        assert result == {"name": "test", "count": 5}

    def test_invalid_uuid_returns_none(self):
        output = {"image": "not-a-valid-uuid"}
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
            },
        }

        result = convert_file_refs_in_output(output, schema, "tenant_123")

        assert result["image"] is None

    def test_file_not_found_returns_none(self):
        file_id = str(uuid.uuid4())
        output = {"image": file_id}
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
            },
        }

        with patch("core.llm_generator.output_parser.file_ref.build_from_mapping") as mock:
            mock.side_effect = ValueError("File not found")
            result = convert_file_refs_in_output(output, schema, "tenant_123")

        assert result["image"] is None

    def test_preserves_non_file_fields(self, mock_build_from_mapping, mock_file):
        file_id = str(uuid.uuid4())
        output = {"query": "search term", "image": file_id, "count": 10}
        schema = {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "image": {"type": "string", "format": FILE_REF_FORMAT},
                "count": {"type": "number"},
            },
        }

        result = convert_file_refs_in_output(output, schema, "tenant_123")

        assert result["query"] == "search term"
        assert isinstance(result["image"], FileSegment)
        assert result["image"].value == mock_file
        assert result["count"] == 10

    def test_does_not_modify_original_output(self, mock_build_from_mapping, mock_file):
        file_id = str(uuid.uuid4())
        original = {"image": file_id}
        output = dict(original)
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_REF_FORMAT},
            },
        }

        convert_file_refs_in_output(output, schema, "tenant_123")

        # Original should still contain the string ID
        assert original["image"] == file_id

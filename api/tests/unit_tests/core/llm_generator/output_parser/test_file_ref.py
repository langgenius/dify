"""
Unit tests for sandbox file path detection and conversion.
"""

import pytest

from core.file import File, FileTransferMethod, FileType
from core.llm_generator.output_parser.file_ref import (
    FILE_PATH_DESCRIPTION_SUFFIX,
    FILE_PATH_FORMAT,
    adapt_schema_for_sandbox_file_paths,
    convert_sandbox_file_paths_in_output,
    detect_file_path_fields,
    is_file_path_property,
)
from core.variables.segments import ArrayFileSegment, FileSegment


def _build_file(file_id: str) -> File:
    return File(
        id=file_id,
        tenant_id="tenant_123",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.TOOL_FILE,
        filename="test.png",
        extension=".png",
        mime_type="image/png",
        size=128,
        related_id=file_id,
        storage_key="sandbox/path",
    )


class TestIsFilePathProperty:
    def test_valid_file_path_format(self):
        schema = {"type": "string", "format": FILE_PATH_FORMAT}
        assert is_file_path_property(schema) is True

    def test_accepts_snake_case_format(self):
        schema = {"type": "string", "format": "file_path"}
        assert is_file_path_property(schema) is True

    def test_invalid_type(self):
        schema = {"type": "number", "format": FILE_PATH_FORMAT}
        assert is_file_path_property(schema) is False

    def test_missing_format(self):
        schema = {"type": "string"}
        assert is_file_path_property(schema) is False

    def test_wrong_format(self):
        schema = {"type": "string", "format": "uuid"}
        assert is_file_path_property(schema) is False


class TestDetectFilePathFields:
    def test_detects_nested_file_paths(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_PATH_FORMAT},
                "files": {"type": "array", "items": {"type": "string", "format": FILE_PATH_FORMAT}},
                "meta": {"type": "object", "properties": {"doc": {"type": "string", "format": FILE_PATH_FORMAT}}},
            },
        }

        assert set(detect_file_path_fields(schema)) == {"image", "files[*]", "meta.doc"}

    def test_empty_schema(self):
        assert detect_file_path_fields({}) == []


class TestAdaptSchemaForSandboxFilePaths:
    def test_appends_description(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": FILE_PATH_FORMAT, "description": "Pick a file"},
            },
        }

        adapted, fields = adapt_schema_for_sandbox_file_paths(schema)

        assert set(fields) == {"image"}
        adapted_image = adapted["properties"]["image"]
        assert adapted_image["type"] == "string"
        assert adapted_image["format"] == FILE_PATH_FORMAT
        assert FILE_PATH_DESCRIPTION_SUFFIX in adapted_image["description"]


class TestConvertSandboxFilePaths:
    def test_convert_sandbox_file_paths(self):
        output = {
            "image": "a.png",
            "files": ["b.png", "c.png"],
            "meta": {"doc": "d.pdf"},
            "name": "demo",
        }

        def resolver(path: str) -> File:
            return _build_file(path)

        converted, files = convert_sandbox_file_paths_in_output(output, ["image", "files[*]", "meta.doc"], resolver)

        assert isinstance(converted["image"], FileSegment)
        assert isinstance(converted["files"], ArrayFileSegment)
        assert isinstance(converted["meta"]["doc"], FileSegment)
        assert converted["name"] == "demo"
        assert [file.id for file in files] == ["a.png", "b.png", "c.png", "d.pdf"]

    def test_invalid_path_value_raises(self):
        with pytest.raises(ValueError):
            convert_sandbox_file_paths_in_output({"image": 123}, ["image"], _build_file)

    def test_no_file_paths_returns_output(self):
        output = {"name": "demo"}
        converted, files = convert_sandbox_file_paths_in_output(output, [], _build_file)

        assert converted == output
        assert files == []

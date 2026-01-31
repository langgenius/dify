"""
Unit tests for sandbox file path detection and conversion.
"""

import pytest

from core.file import File, FileTransferMethod, FileType
from core.llm_generator.output_parser.file_ref import (
    FILE_PATH_DESCRIPTION_SUFFIX,
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


class TestFilePathSchema:
    def test_is_file_path_property(self):
        assert is_file_path_property({"type": "file"}) is True
        assert is_file_path_property({"type": "string", "format": "dify-file-ref"}) is True
        assert is_file_path_property({"type": "string"}) is False

    def test_detect_file_path_fields(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": "dify-file-ref"},
                "files": {"type": "array", "items": {"type": "string", "format": "dify-file-ref"}},
                "meta": {"type": "object", "properties": {"doc": {"type": "file"}}},
            },
        }
        assert set(detect_file_path_fields(schema)) == {"image", "files[*]", "meta.doc"}

    def test_adapt_schema_for_sandbox_file_paths(self):
        schema = {
            "type": "object",
            "properties": {
                "image": {"type": "string", "format": "dify-file-ref"},
                "name": {"type": "string"},
            },
        }
        adapted, fields = adapt_schema_for_sandbox_file_paths(schema)

        assert set(fields) == {"image"}
        adapted_image = adapted["properties"]["image"]
        assert adapted_image["type"] == "string"
        assert "format" not in adapted_image
        assert FILE_PATH_DESCRIPTION_SUFFIX in adapted_image["description"]


class TestConvertSandboxFilePaths:
    def test_convert_sandbox_file_paths(self):
        output = {"image": "a.png", "files": ["b.png", "c.png"], "name": "demo"}

        def resolver(path: str) -> File:
            return _build_file(path)

        converted, files = convert_sandbox_file_paths_in_output(output, ["image", "files[*]"], resolver)

        assert isinstance(converted["image"], FileSegment)
        assert isinstance(converted["files"], ArrayFileSegment)
        assert converted["name"] == "demo"
        assert [file.id for file in files] == ["a.png", "b.png", "c.png"]

    def test_invalid_path_value_raises(self):
        def resolver(path: str) -> File:
            return _build_file(path)

        with pytest.raises(ValueError):
            convert_sandbox_file_paths_in_output({"image": 123}, ["image"], resolver)

    def test_no_file_paths_returns_output(self):
        output = {"name": "demo"}
        converted, files = convert_sandbox_file_paths_in_output(output, [], _build_file)

        assert converted == output
        assert files == []

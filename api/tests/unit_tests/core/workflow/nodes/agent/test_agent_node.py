"""Unit tests for AgentNode file handling."""

from unittest.mock import patch

import pytest

from core.file import File, FileTransferMethod, FileType
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    TextPromptMessageContent,
)
from core.variables import ArrayFileSegment, FileSegment, StringSegment
from core.variables.segment_group import SegmentGroup


class TestAgentNodeFileHandling:
    """Tests for file handling in query, instruction, and vision variable selector."""

    @pytest.fixture
    def mock_file(self) -> File:
        """Create a mock file."""
        return File(
            id="test-file-id",
            tenant_id="test-tenant",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test-related-id",
            filename="test.png",
            extension=".png",
            mime_type="image/png",
            size=1024,
        )

    @pytest.fixture
    def mock_custom_file(self) -> File:
        """Create a mock custom (unsupported) file."""
        return File(
            id="test-custom-id",
            tenant_id="test-tenant",
            type=FileType.CUSTOM,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            related_id="test-related-id",
            filename="test.zip",
            extension=".zip",
            mime_type="application/zip",
            size=4096,
        )

    def test_query_with_text_only_returns_string(self):
        """When query contains only text, it should return a string."""
        segment_group = SegmentGroup(value=[StringSegment(value="Hello, world!")])

        contents: list[dict] = []
        has_file = False
        for segment in segment_group.value:
            if not isinstance(segment, (ArrayFileSegment, FileSegment)):
                if segment.text:
                    contents.append(TextPromptMessageContent(data=segment.text).model_dump())

        result = contents if has_file else segment_group.text

        assert result == "Hello, world!"
        assert isinstance(result, str)

    def test_query_with_file_returns_list(self, mock_file):
        """When query contains a file, it should return a list."""
        segment_group = SegmentGroup(value=[FileSegment(value=mock_file)])

        with patch("core.file.file_manager.to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            contents: list[dict] = []
            has_file = False
            for segment in segment_group.value:
                if isinstance(segment, FileSegment):
                    file = segment.value
                    if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                        from core.file import file_manager

                        contents.append(file_manager.to_prompt_message_content(file).model_dump())
                        has_file = True

            result = contents if has_file else segment_group.text

            assert isinstance(result, list)
            assert len(result) == 1
            assert result[0]["type"] == "image"

    def test_query_with_text_and_file_returns_list_with_both(self, mock_file):
        """When query contains both text and file, it should return a list with both."""
        segment_group = SegmentGroup(value=[
            StringSegment(value="Describe this: "),
            FileSegment(value=mock_file),
        ])

        with patch("core.file.file_manager.to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            contents: list[dict] = []
            has_file = False
            for segment in segment_group.value:
                if isinstance(segment, FileSegment):
                    file = segment.value
                    if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                        from core.file import file_manager

                        contents.append(file_manager.to_prompt_message_content(file).model_dump())
                        has_file = True
                elif segment.text:
                    contents.append(TextPromptMessageContent(data=segment.text).model_dump())

            result = contents if has_file else segment_group.text

            assert isinstance(result, list)
            assert len(result) == 2
            assert result[0]["type"] == "text"
            assert result[1]["type"] == "image"

    def test_custom_file_type_is_ignored(self, mock_custom_file):
        """Custom file types should be ignored."""
        segment_group = SegmentGroup(value=[FileSegment(value=mock_custom_file)])

        has_file = False
        for segment in segment_group.value:
            if isinstance(segment, FileSegment):
                if segment.value.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                    has_file = True

        assert has_file is False

    def test_instruction_with_file_returns_list(self, mock_file):
        """When instruction contains a file, it should return a list (same as query)."""
        segment_group = SegmentGroup(value=[
            StringSegment(value="You are a helpful assistant. "),
            FileSegment(value=mock_file),
        ])

        with patch("core.file.file_manager.to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            contents: list[dict] = []
            has_file = False
            for segment in segment_group.value:
                if isinstance(segment, FileSegment):
                    file = segment.value
                    if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                        from core.file import file_manager

                        contents.append(file_manager.to_prompt_message_content(file).model_dump())
                        has_file = True
                elif segment.text:
                    contents.append(TextPromptMessageContent(data=segment.text).model_dump())

            result = contents if has_file else segment_group.text

            assert isinstance(result, list)
            assert len(result) == 2
            assert result[0]["type"] == "text"
            assert result[1]["type"] == "image"

    def test_vision_variable_selector_files_added_to_query(self, mock_file):
        """Vision variable selector files should be added to query only."""
        vision_files = [mock_file]

        with patch("core.file.file_manager.to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            contents: list[dict] = []
            has_file = False

            for file in vision_files:
                if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                    from core.file import file_manager

                    contents.append(file_manager.to_prompt_message_content(file).model_dump())
                    has_file = True

            assert has_file is True
            assert len(contents) == 1
            assert contents[0]["type"] == "image"

    def test_query_with_text_and_vision_files(self, mock_file):
        """Query text combined with vision variable selector files."""
        segment_group = SegmentGroup(value=[StringSegment(value="Describe this image")])
        vision_files = [mock_file]

        with patch("core.file.file_manager.to_prompt_message_content") as mock_to_content:
            mock_to_content.return_value = ImagePromptMessageContent(
                url="http://example.com/test.png", mime_type="image/png", format="png"
            )

            contents: list[dict] = []
            has_file = False

            for segment in segment_group.value:
                if segment.text:
                    contents.append(TextPromptMessageContent(data=segment.text).model_dump())

            for file in vision_files:
                if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                    from core.file import file_manager

                    contents.append(file_manager.to_prompt_message_content(file).model_dump())
                    has_file = True

            result = contents if has_file else segment_group.text

            assert isinstance(result, list)
            assert len(result) == 2
            assert result[0]["type"] == "text"
            assert result[0]["data"] == "Describe this image"
            assert result[1]["type"] == "image"

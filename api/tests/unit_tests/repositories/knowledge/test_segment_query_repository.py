"""Pure tests for segment read-query helpers."""

from repositories.knowledge.segment_query_repository import segment_content_file_ids


def test_segment_content_file_ids_extracts_normalized_persisted_references() -> None:
    upload_id = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"
    tool_id = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"
    content = (
        f"![upload](/files/{upload_id}/image-preview?timestamp=1) "
        f"[tool](/files/tools/{tool_id}.txt?sign=signature) "
        "/files/not-a-uuid/file-preview"
    )

    uploads, tools = segment_content_file_ids(content)

    assert uploads == {upload_id.lower()}
    assert tools == {tool_id.lower()}

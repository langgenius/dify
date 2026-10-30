from core.workflow.file_reference import build_file_reference
from services.file_reference_parser import (
    added_trusted_upload_file_ids,
    extract_upload_file_ids_from_markdown,
    trusted_upload_file_ids,
)


def test_extract_upload_file_ids_from_markdown() -> None:
    content = "![image](https://example.com/a/b/files/abc123/file-preview)"
    assert extract_upload_file_ids_from_markdown(content) == ("abc123",)

    content = "![image](http://host/files/xyz789/image-preview)"
    assert extract_upload_file_ids_from_markdown(content) == ("xyz789",)

    content = "![image](htt://host/files/bad/file-preview)"
    assert extract_upload_file_ids_from_markdown(content) == ()

    content = (
        "some text\n![image](https://h/files/id1/file-preview)\nmiddle\n![image](http://h/files/id2/image-preview)\nend"
    )
    assert extract_upload_file_ids_from_markdown(content) == ("id1", "id2")


def test_extract_upload_file_ids_uses_full_markdown_image_grammar() -> None:
    content = (
        '![architecture diagram](/files/relative-id/file-preview "diagram")\n'
        "![reference image][stored-image]\n"
        "[stored-image]: https://example.test/files/reference-id/image-preview\n"
        "[ordinary link](/files/not-an-image/file-preview)\n"
        '<img alt="inline html" src="/files/html-id/image-preview?timestamp=1">'
    )

    assert extract_upload_file_ids_from_markdown(content) == ("relative-id", "reference-id", "html-id")


def test_trusted_upload_file_ids_only_accepts_explicit_file_shapes() -> None:
    canonical_id = "canonical-file"
    payload = {
        "unrelated_id": "ordinary-uuid-looking-value",
        "prompt": f"preview {build_file_reference(record_id=canonical_id)}",
        "config_files": [
            {"file_kind": "upload_file", "file_id": "config-file"},
            {"file_kind": "tool_file", "file_id": "tool-file"},
        ],
        "input": {"transfer_method": "local_file", "upload_file_id": "input-file"},
        "legacy_input": {"transfer_method": "local_file", "related_id": "legacy-input-file"},
        "markdown": "![preview](/files/markdown-file/file-preview)",
    }

    assert trusted_upload_file_ids(payload) == {
        canonical_id,
        "config-file",
        "input-file",
        "legacy-input-file",
        "markdown-file",
    }


def test_trusted_upload_file_ids_treats_typed_file_mappings_as_leaf_nodes() -> None:
    upload_reference = build_file_reference(record_id="upload-file")
    datasource_reference = build_file_reference(record_id="datasource-file")
    tool_reference = build_file_reference(record_id="tool-file")

    payload = {
        "local": {"transfer_method": "local_file", "reference": upload_reference},
        "datasource": {"transfer_method": "datasource_file", "reference": datasource_reference},
        "legacy_datasource": {
            "transfer_method": "datasource_file",
            "datasource_file_id": "legacy-datasource-file",
        },
        "tool": {"transfer_method": "tool_file", "reference": tool_reference},
    }

    assert trusted_upload_file_ids(payload) == {"upload-file", "datasource-file", "legacy-datasource-file"}


def test_trusted_upload_file_ids_does_not_accept_raw_ids_outside_typed_file_shapes() -> None:
    assert trusted_upload_file_ids({"related_id": "ordinary-id", "message": "ordinary-id"}) == set()


def test_trusted_upload_file_ids_treats_only_image_icons_as_upload_files() -> None:
    assert trusted_upload_file_ids({"icon_type": "image", "icon": "image-file"}) == {"image-file"}
    assert trusted_upload_file_ids({"icon_type": "emoji", "icon": "image-file"}) == set()


def test_added_trusted_upload_file_ids_ignores_unchanged_historical_references() -> None:
    previous = {
        "config_files": [{"file_kind": "upload_file", "file_id": "historical-file"}],
        "unrelated": "before",
    }
    current = {
        "config_files": [
            {"file_kind": "upload_file", "file_id": "historical-file"},
            {"file_kind": "upload_file", "file_id": "new-file"},
        ],
        "unrelated": "after",
    }

    assert added_trusted_upload_file_ids(previous=previous, current=current) == {"new-file"}

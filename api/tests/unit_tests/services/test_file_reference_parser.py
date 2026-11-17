import time

import pytest

from core.workflow.file_reference import build_file_reference
from services.file_reference_parser import (
    TextLinkedUploadFileId,
    added_trusted_upload_file_ids,
    extract_upload_file_ids_from_markdown,
    trusted_upload_file_ids,
)

_ID_1 = "11111111-1111-4111-8111-111111111111"
_ID_2 = "22222222-2222-4222-8222-222222222222"
_ID_3 = "33333333-3333-4333-8333-333333333333"


def test_extract_upload_file_ids_from_markdown() -> None:
    content = f"![image](https://example.com/a/b/files/{_ID_1}/file-preview)"
    assert extract_upload_file_ids_from_markdown(content) == (_ID_1,)

    content = f"![image](http://host/files/{_ID_2}/image-preview)"
    assert extract_upload_file_ids_from_markdown(content) == (_ID_2,)

    content = f"![image](htt://host/files/{_ID_1}/file-preview)"
    assert extract_upload_file_ids_from_markdown(content) == ()

    content = (
        f"some text\n![image](https://h/files/{_ID_1}/file-preview)\nmiddle\n"
        f"![image](http://h/files/{_ID_2}/image-preview?timestamp=1&sign=x)\nend"
    )
    assert extract_upload_file_ids_from_markdown(content) == (_ID_1, _ID_2)


def test_extract_upload_file_ids_resolves_relative_preview_links() -> None:
    content = f"![a](/files/{_ID_1}/file-preview) ![b](files/{_ID_2}/image-preview) ![c](</files/{_ID_3}/file-preview>)"

    assert extract_upload_file_ids_from_markdown(content) == (_ID_1, _ID_2, _ID_3)


def test_extract_upload_file_ids_uses_full_markdown_image_grammar() -> None:
    content = (
        f'![architecture diagram](/files/{_ID_1}/file-preview "diagram")\n'
        "![reference image][stored-image]\n"
        f"[stored-image]: https://example.test/files/{_ID_2}/image-preview\n"
        "[ordinary link](/files/44444444-4444-4444-8444-444444444444/file-preview)\n"
        f'<img alt="inline html" src="/files/{_ID_3}/image-preview?timestamp=1">'
    )

    assert extract_upload_file_ids_from_markdown(content) == (_ID_1, _ID_2, _ID_3)


def test_extract_upload_file_ids_only_accepts_uuid_shaped_ids() -> None:
    content = (
        "![blog](https://blog.example/files/2024/image-preview)\n"
        "![short](/files/abc/file-preview)\n"
        f"![query](https://example.test/view?next=/files/{_ID_1}/file-preview)\n"
        f"![other path](/profiles/{_ID_1}/file-preview)\n"
        f"![upper](/files/{_ID_2.upper()}/file-preview)"
    )

    assert extract_upload_file_ids_from_markdown(content) == (_ID_2,)


@pytest.mark.parametrize(
    "content",
    [
        "![" * 100_000,
        "lorem ipsum dolor sit amet " * 8_000,
        "![](" * 50_000,
        "![a][" * 40_000,
        '<img src="a ' * 20_000,
        "![a](" + "a/files/" * 30_000,
    ],
    ids=["unclosed-images", "plain-prose", "empty-destinations", "open-references", "open-html", "long-destination"],
)
def test_extract_upload_file_ids_parses_pathological_content_in_linear_time(content: str) -> None:
    # The Markdown renderer this replaced needed 45s for 80k characters of "![".
    content += f" ![tail](/files/{_ID_1}/file-preview)"
    assert len(content) >= 200_000

    started_at = time.perf_counter()
    file_ids = extract_upload_file_ids_from_markdown(content)
    elapsed = time.perf_counter() - started_at

    assert file_ids == (_ID_1,)
    assert elapsed < 1.0


def test_trusted_upload_file_ids_marks_only_text_links_as_text_linked() -> None:
    structured_and_linked = build_file_reference(record_id=_ID_1)
    payload = {
        "answer": f"![a](/files/{_ID_1}/file-preview) ![b](/files/{_ID_2}/file-preview) {structured_and_linked}",
        "input": {"transfer_method": "local_file", "upload_file_id": _ID_3},
    }

    file_ids = trusted_upload_file_ids(payload)

    assert file_ids == {_ID_1, _ID_2, _ID_3}
    assert {file_id for file_id in file_ids if isinstance(file_id, TextLinkedUploadFileId)} == {_ID_2}
    introduced = added_trusted_upload_file_ids(previous={}, current=payload)
    assert {file_id for file_id in sorted(introduced) if isinstance(file_id, TextLinkedUploadFileId)} == {_ID_2}


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
        "markdown": f"![preview](/files/{_ID_1}/file-preview)",
    }

    assert trusted_upload_file_ids(payload) == {
        canonical_id,
        "config-file",
        "input-file",
        "legacy-input-file",
        _ID_1,
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

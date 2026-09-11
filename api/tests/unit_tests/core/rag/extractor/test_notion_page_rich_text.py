from unittest import mock

from core.rag.extractor import notion_extractor


def _mock_response(data):
    response = mock.Mock()
    response.status_code = 200
    response.text = ""
    response.json.return_value = data
    return response


def _extractor() -> notion_extractor.NotionExtractor:
    return notion_extractor.NotionExtractor(
        notion_workspace_id="ws",
        notion_obj_id="obj",
        notion_page_type="page",
        tenant_id="tenant",
        notion_access_token="token",
    )


def _mixed_rich_text():
    return [
        {"type": "text", "plain_text": "See ", "text": {"content": "See "}},
        {
            "type": "mention",
            "plain_text": "Project Alpha",
            "mention": {"type": "page", "page": {"id": "page-id"}},
        },
        {"type": "equation", "plain_text": "E = mc^2", "equation": {"expression": "E = mc^2"}},
    ]


def _paragraph_payload():
    return {
        "results": [
            {
                "type": "paragraph",
                "id": "paragraph-id",
                "has_children": False,
                "paragraph": {"rich_text": _mixed_rich_text()},
            }
        ],
        "next_cursor": None,
    }


def test_get_notion_block_data_preserves_mentions_and_equations():
    extractor = _extractor()

    with mock.patch("httpx.request", return_value=_mock_response(_paragraph_payload())):
        lines = extractor._get_notion_block_data("page-id")

    assert lines == ["See \nProject Alpha\nE = mc^2\n\n"]


def test_read_block_preserves_mentions_and_equations():
    extractor = _extractor()

    with mock.patch("httpx.request", return_value=_mock_response(_paragraph_payload())):
        content = extractor._read_block("child-block-id", num_tabs=1)

    assert content == "\tSee \n\tProject Alpha\n\tE = mc^2\n\n"

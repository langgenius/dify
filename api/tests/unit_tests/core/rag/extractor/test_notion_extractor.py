from unittest import mock

from core.rag.extractor import notion_extractor

user_id = "user1"
database_id = "database1"
page_id = "page1"


extractor = notion_extractor.NotionExtractor(
        notion_workspace_id='x',
        notion_obj_id='x',
        notion_page_type='page',
        tenant_id='x',
        notion_access_token='x')


def _generate_page(page_title: str):
    return {
        "object": "page",
        "id": page_id,
        "properties": {
            "Page": {
                "type": "title", 
                "title": [
                    {
                        "type": "text",
                        "text": {"content": page_title},
                        "plain_text": page_title
                    }
                ]
            }
        }
    }


def _generate_block(block_id: str, block_type: str, block_text: str):
    return {
        "object": "block",
        "id": block_id,
        "parent": {
            "type": "page_id",
            "page_id": page_id
        },
        "type": block_type,
        "has_children": False,
        block_type: {
            "rich_text": [
                {
                    "type": "text",
                    "text": {"content": block_text},
                   "plain_text": block_text,
               }]
           }
       }


def _mock_response(data):
    response = mock.Mock()
    response.status_code = 200
    response.json.return_value = data
    return response


def _remove_multiple_new_lines(text):
    while '\n\n' in text:
        text = text.replace("\n\n", "\n")
    return text.strip()


def test_notion_page(mocker):
    texts = ["Head 1", "1.1", "paragraph 1", "1.1.1"]
    mocked_notion_page = {
    "object": "list",
    "results": [
        _generate_block("b1", "heading_1", texts[0]),
        _generate_block("b2", "heading_2", texts[1]),
        _generate_block("b3", "paragraph", texts[2]),
        _generate_block("b4", "heading_3", texts[3])
    ],
    "next_cursor": None
    }
    mocker.patch("requests.request", return_value=_mock_response(mocked_notion_page))

    page_docs = extractor._load_data_as_documents(page_id, "page")
    assert len(page_docs) == 1
    content = _remove_multiple_new_lines(page_docs[0].page_content)
    assert content == '# Head 1\n## 1.1\nparagraph 1\n### 1.1.1'


def test_notion_database(mocker):
    page_title_list = ["page1", "page2", "page3"]
    mocked_notion_database = {
        "object": "list",
        "results": [_generate_page(i) for i in page_title_list],
        "next_cursor": None
    }
    mocker.patch("requests.post", return_value=_mock_response(mocked_notion_database))
    database_docs = extractor._load_data_as_documents(database_id, "database")
    assert len(database_docs) == 1
    content = _remove_multiple_new_lines(database_docs[0].page_content)
    assert content == '\n'.join([f'Page:{i}' for i in page_title_list])

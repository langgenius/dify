"""Unit tests for the pure Notion extractor and its HTTP boundary."""

from unittest import mock

import httpx
import pytest
from pytest_mock import MockerFixture

from core.rag.extractor import notion_extractor
from core.rag.models.document import Document


def _response(data: object, *, status_code: int = 200, text: str = "") -> mock.Mock:
    response = mock.Mock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = data
    return response


def _extractor(*, object_id: str = "object-id", page_type: str = "page") -> notion_extractor.NotionExtractor:
    return notion_extractor.NotionExtractor(
        notion_obj_id=object_id,
        notion_page_type=page_type,
        notion_access_token="token",
    )


class TestNotionExtractor:
    @pytest.mark.parametrize("token", ["", None])
    def test_init_rejects_missing_access_token(self, token: str | None) -> None:
        with pytest.raises(ValueError, match="Notion access token is required"):
            notion_extractor.NotionExtractor(
                notion_obj_id="object-id",
                notion_page_type="page",
                notion_access_token=token,  # type: ignore[arg-type]
            )

    def test_extract_delegates_without_fetching_source_version(self, monkeypatch: pytest.MonkeyPatch) -> None:
        extractor = _extractor()
        calls: list[tuple[str, str]] = []

        def load_documents(object_id: str, page_type: str) -> list[Document]:
            calls.append((object_id, page_type))
            return [Document(page_content="document")]

        monkeypatch.setattr(extractor, "_load_data_as_documents", load_documents)
        monkeypatch.setattr(
            extractor,
            "get_notion_last_edited_time",
            lambda: pytest.fail("preview extraction must not fetch the source version"),
        )

        assert extractor.extract() == [Document(page_content="document")]
        assert calls == [("object-id", "page")]

    def test_load_data_as_documents_supports_page_and_database(self, monkeypatch: pytest.MonkeyPatch) -> None:
        extractor = _extractor()
        monkeypatch.setattr(extractor, "_get_notion_block_data", lambda _: ["one", "two"])
        monkeypatch.setattr(
            extractor,
            "_get_notion_database_data",
            lambda _: [Document(page_content="database")],
        )

        assert extractor._load_data_as_documents("page-id", "page")[0].page_content == "one\ntwo"
        assert extractor._load_data_as_documents("database-id", "database")[0].page_content == "database"
        with pytest.raises(ValueError, match="notion page type not supported"):
            extractor._load_data_as_documents("object-id", "unsupported")


class TestNotionDatabase:
    def test_database_properties_preserve_all_text_segments_and_pagination(self, mocker: MockerFixture) -> None:
        extractor = _extractor(page_type="database")
        first_page = {
            "results": [
                {
                    "properties": {
                        "Title": {
                            "type": "title",
                            "title": [{"plain_text": "Hello "}, {"plain_text": "world"}],
                        },
                        "Description": {
                            "type": "rich_text",
                            "rich_text": [{"plain_text": "first "}, {"plain_text": "second"}],
                        },
                        "Tags": {
                            "type": "multi_select",
                            "multi_select": [{"name": "one"}, {"name": "two"}],
                        },
                        "Status": {"type": "status", "status": {"name": "Open"}},
                    },
                    "url": "https://notion.so/page",
                }
            ],
            "has_more": True,
            "next_cursor": "next-page",
        }
        second_page: dict[str, object] = {
            "results": list[object](),
            "has_more": False,
            "next_cursor": None,
        }
        post = mocker.patch("httpx.post", side_effect=[_response(first_page), _response(second_page)])

        documents = extractor._get_notion_database_data("database-id", {"filter": {"x": 1}})

        assert len(documents) == 1
        assert "Title:Hello world" in documents[0].page_content
        assert "Description:first second" in documents[0].page_content
        assert "Tags:['one', 'two']" in documents[0].page_content
        assert "Status:Open" in documents[0].page_content
        assert "Row Page URL:https://notion.so/page" in documents[0].page_content
        assert post.call_count == 2
        assert post.call_args_list[1].kwargs["json"]["start_cursor"] == "next-page"
        assert post.call_args_list[0].kwargs["timeout"] == notion_extractor._REQUEST_TIMEOUT

    def test_database_http_error_never_returns_partial_documents(self, monkeypatch: pytest.MonkeyPatch) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(
                    200,
                    json={
                        "results": [{"properties": {"Title": {"type": "title", "title": [{"plain_text": "first"}]}}}],
                        "has_more": True,
                        "next_cursor": "next-page",
                    },
                )
            return httpx.Response(503, text="unavailable")

        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            monkeypatch.setattr(notion_extractor.httpx, "post", client.post)
            with pytest.raises(httpx.HTTPStatusError):
                _extractor(page_type="database").extract()

        assert len(requests) == 2

    def test_database_empty_results_return_no_documents(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "httpx.post",
            return_value=_response({"results": [], "has_more": False, "next_cursor": None}),
        )
        assert _extractor(page_type="database").extract() == []


class TestNotionBlocks:
    def test_block_data_preserves_plain_text_for_mentions_and_equations(self, mocker: MockerFixture) -> None:
        payload = {
            "results": [
                {
                    "type": "paragraph",
                    "id": "paragraph-id",
                    "has_children": False,
                    "paragraph": {
                        "rich_text": [
                            {"type": "text", "plain_text": "See ", "text": {"content": "See "}},
                            {"type": "mention", "plain_text": "Project Alpha", "mention": {"type": "page"}},
                            {"type": "equation", "plain_text": "E=mc^2", "equation": {"expression": "E=mc^2"}},
                        ]
                    },
                }
            ],
            "next_cursor": None,
        }
        request = mocker.patch("httpx.request", return_value=_response(payload))

        lines = _extractor()._get_notion_block_data("page-id")

        assert lines == ["See \nProject Alpha\nE=mc^2\n\n"]
        assert request.call_args.kwargs["timeout"] == notion_extractor._REQUEST_TIMEOUT

    def test_block_data_handles_children_tables_headings_and_pagination(self, mocker: MockerFixture) -> None:
        extractor = _extractor()
        first_page = {
            "results": [
                {
                    "type": "table",
                    "id": "table-id",
                    "has_children": False,
                    "table": dict[str, object](),
                },
                {
                    "type": "heading_1",
                    "id": "heading-id",
                    "has_children": False,
                    "heading_1": {"rich_text": [{"text": {"content": "Heading"}}]},
                },
                {
                    "type": "paragraph",
                    "id": "parent-id",
                    "has_children": True,
                    "paragraph": {"rich_text": [{"text": {"content": "Parent"}}]},
                },
            ],
            "next_cursor": "next-page",
        }
        second_page: dict[str, object] = {"results": list[object](), "next_cursor": None}
        mocker.patch("httpx.request", side_effect=[_response(first_page), _response(second_page)])
        mocker.patch.object(extractor, "_read_table_rows", return_value="TABLE")
        mocker.patch.object(extractor, "_read_block", return_value="CHILD")

        lines = extractor._get_notion_block_data("page-id")

        assert lines == ["TABLE\n\n", "# Heading", "Parent\nCHILD\n\n"]

    @pytest.mark.parametrize(
        ("response", "message"),
        [
            (_response({"results": []}, status_code=500, text="boom"), "Error fetching Notion block data: boom"),
            (_response({"invalid": True}), "Error fetching Notion block data"),
        ],
    )
    def test_block_data_rejects_http_and_payload_errors(
        self,
        mocker: MockerFixture,
        response: mock.Mock,
        message: str,
    ) -> None:
        mocker.patch("httpx.request", return_value=response)
        with pytest.raises(ValueError, match=message):
            _extractor()._get_notion_block_data("page-id")

    def test_block_data_translates_transport_errors(self, mocker: MockerFixture) -> None:
        mocker.patch("httpx.request", side_effect=httpx.HTTPError("network"))
        with pytest.raises(ValueError, match="Error fetching Notion block data"):
            _extractor()._get_notion_block_data("page-id")

    def test_table_rows_keep_mixed_and_empty_cells_in_their_columns(self, mocker: MockerFixture) -> None:
        payload = {
            "results": [
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "Name"}}],
                            [{"text": {"content": "Description"}}],
                            [{"text": {"content": "Owner"}}],
                        ]
                    }
                },
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "Item"}}],
                            list[dict[str, object]](),
                            [
                                {"type": "mention", "plain_text": "@alice", "mention": {"type": "user"}},
                                {"type": "equation", "plain_text": "x=1", "equation": {"expression": "x=1"}},
                            ],
                        ]
                    }
                },
            ],
            "next_cursor": None,
        }
        mocker.patch("httpx.request", return_value=_response(payload))

        markdown = _extractor()._read_table_rows("table-id")

        assert "| Item |  | @alicex=1 |" in markdown
        for line in markdown.splitlines():
            if line.startswith("|"):
                assert line.count("|") == 4


def test_last_edited_time_uses_resource_specific_url(mocker: MockerFixture) -> None:
    request = mocker.patch(
        "httpx.request",
        return_value=_response({"last_edited_time": "2026-10-30T00:00:00Z"}),
    )

    assert _extractor(object_id="page-id").get_notion_last_edited_time() == "2026-10-30T00:00:00Z"
    assert "pages/page-id" in request.call_args.args[1]

    request = mocker.patch(
        "httpx.request",
        return_value=_response({"last_edited_time": "2026-10-31T00:00:00Z"}),
    )
    assert (
        _extractor(object_id="database-id", page_type="database").get_notion_last_edited_time()
        == "2026-10-31T00:00:00Z"
    )
    assert "databases/database-id" in request.call_args.args[1]

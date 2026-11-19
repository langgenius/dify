"""Unit tests for the pure Notion extractor and its HTTP boundary."""

import json
from unittest import mock

import httpx
import pytest
from pydantic import ValidationError
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


def _table_extractor() -> notion_extractor.NotionExtractor:
    """Return a page extractor with a synthetic access token and no external state."""
    return _extractor(object_id="page")


def _table_page(header: str, next_cursor: str | None = None) -> dict[str, object]:
    """Build one valid table page whose cursor controls whether another request is required."""
    return {
        "results": [{"table_row": {"cells": [[{"plain_text": header}]]}}],
        "next_cursor": next_cursor,
    }


def test_table_rows_empty_response_returns_empty_content(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid terminal page without rows produces empty content after one request."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Record the synthetic table request and return a valid empty terminal page."""
        requests.append(request)
        return httpx.Response(200, json={"results": [], "next_cursor": None})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        content = _table_extractor()._read_table_rows("table")

    assert content == ""
    assert len(requests) == 1
    assert requests[0].url.params.get("start_cursor") is None


def test_table_rows_empty_page_advances_to_the_next_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty nonterminal page advances its cursor and returns the later page's Markdown."""
    cursors: list[str | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Return an empty first page followed by one table page for the supplied cursor."""
        cursor = request.url.params.get("start_cursor")
        cursors.append(cursor)
        if cursor is None:
            return httpx.Response(200, json={"results": [], "next_cursor": "next-page"})
        return httpx.Response(200, json=_table_page("Header"))

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        content = _table_extractor()._read_table_rows("table")

    assert content == "| Header |\n| --- |\n"
    assert cursors == [None, "next-page"]


def test_table_rows_empty_final_page_preserves_prior_content(monkeypatch: pytest.MonkeyPatch) -> None:
    """A terminal empty page leaves successfully rendered prior pages intact."""
    cursors: list[str | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Return one rendered page followed by an empty terminal page."""
        cursor = request.url.params.get("start_cursor")
        cursors.append(cursor)
        if cursor is None:
            return httpx.Response(200, json=_table_page("Header", "next-page"))
        return httpx.Response(200, json={"results": [], "next_cursor": None})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        content = _table_extractor()._read_table_rows("table")

    assert content == "| Header |\n| --- |\n"
    assert cursors == [None, "next-page"]


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
@pytest.mark.parametrize("after_first_page", [False, True], ids=["first-page", "later-page"])
def test_table_rows_http_errors_do_not_return_empty_or_partial_content(
    monkeypatch: pytest.MonkeyPatch, status: int, after_first_page: bool
) -> None:
    """Any failed table page raises HTTPStatusError before empty or partial content can return."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Optionally return one valid page, then a synthetic Notion HTTP error."""
        requests.append(request)
        if after_first_page and len(requests) == 1:
            return httpx.Response(200, json=_table_page("Header", "next-page"))
        return httpx.Response(
            status,
            json={"object": "error", "status": status, "code": "synthetic_error", "message": "Synthetic failure"},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(httpx.HTTPStatusError) as caught:
            _table_extractor()._read_table_rows("table")

    assert caught.value.response.status_code == status
    assert len(requests) == (2 if after_first_page else 1)


def test_table_rows_http_errors_are_checked_before_decoding_json(monkeypatch: pytest.MonkeyPatch) -> None:
    """A failed non-JSON response raises for its HTTP status before body decoding."""

    def respond(_request: httpx.Request) -> httpx.Response:
        """Return a synthetic HTML service failure for any table request."""
        return httpx.Response(503, text="<html>Service unavailable</html>")

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(httpx.HTTPStatusError) as caught:
            _table_extractor()._read_table_rows("table")

    assert caught.value.response.status_code == 503


@pytest.mark.parametrize("after_first_page", [False, True], ids=["first-page", "later-page"])
def test_table_rows_success_with_invalid_json_does_not_return_partial_content(
    monkeypatch: pytest.MonkeyPatch, after_first_page: bool
) -> None:
    """A 200 response with invalid JSON propagates decoding failure, including after prior pages."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Optionally return one valid page, then a successful response with invalid JSON."""
        requests.append(request)
        if after_first_page and len(requests) == 1:
            return httpx.Response(200, json=_table_page("Header", "next-page"))
        return httpx.Response(200, text="not-json")

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(json.JSONDecodeError):
            _table_extractor()._read_table_rows("table")

    assert len(requests) == (2 if after_first_page else 1)


@pytest.mark.parametrize(
    "invalid_page",
    [
        {"next_cursor": None},
        {"results": []},
        {"results": None, "next_cursor": None},
        {"results": "not-a-list", "next_cursor": None},
        {"results": ["not-an-object"], "next_cursor": None},
        [],
        {"results": [], "next_cursor": 42},
    ],
    ids=[
        "missing-results",
        "missing-next-cursor",
        "null-results",
        "non-list-results",
        "non-object-result",
        "non-object-page",
        "invalid-cursor",
    ],
)
@pytest.mark.parametrize("after_first_page", [False, True], ids=["first-page", "later-page"])
def test_table_rows_reject_malformed_success_responses(
    monkeypatch: pytest.MonkeyPatch, invalid_page: object, after_first_page: bool
) -> None:
    """Malformed successful pages fail validation before empty or partial content can return."""
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        """Optionally return one valid page, then the supplied malformed success payload."""
        requests.append(request)
        if after_first_page and len(requests) == 1:
            return httpx.Response(200, json=_table_page("Header", "next-page"))
        return httpx.Response(200, json=invalid_page)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(ValidationError):
            _table_extractor()._read_table_rows("table")

    assert len(requests) == (2 if after_first_page else 1)


def test_table_rows_network_errors_propagate(monkeypatch: pytest.MonkeyPatch) -> None:
    """A table transport failure propagates without producing content."""

    def respond(request: httpx.Request) -> httpx.Response:
        """Raise a synthetic connection failure for the accepted table request."""
        raise httpx.ConnectError("Synthetic connection failure", request=request)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(httpx.ConnectError, match="Synthetic connection failure"):
            _table_extractor()._read_table_rows("table")


def test_page_import_does_not_return_a_partial_document_when_table_loading_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Page extraction fails when one table request fails, even after other blocks were read."""

    def respond(request: httpx.Request) -> httpx.Response:
        """Return a mixed page root, then rate-limit its nested table request."""
        if request.url.path.endswith("/page/children"):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "type": "paragraph",
                            "id": "paragraph",
                            "has_children": False,
                            "paragraph": {"rich_text": [{"plain_text": "Retained paragraph"}]},
                        },
                        {"type": "table", "id": "table", "has_children": True, "table": {}},
                    ],
                    "next_cursor": None,
                },
            )
        assert request.url.path.endswith("/table/children")
        return httpx.Response(
            429,
            json={"object": "error", "status": 429, "code": "rate_limited", "message": "Synthetic failure"},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        monkeypatch.setattr(notion_extractor.httpx, "request", client.request)
        with pytest.raises(httpx.HTTPStatusError) as caught:
            _table_extractor()._load_data_as_documents("page", "page")

    assert caught.value.response.status_code == 429


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

from types import SimpleNamespace
from unittest import mock

import httpx
import pytest
from pytest_mock import MockerFixture

from core.rag.extractor import notion_extractor


def _mock_response(data, status_code: int = 200, text: str = ""):
    response = mock.Mock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = data
    return response


class TestNotionExtractorInitAndPublicMethods:
    def test_init_with_explicit_token(self):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        assert extractor._notion_access_token == "token"

    def test_init_falls_back_to_env_token_when_credential_lookup_fails(self, monkeypatch):
        monkeypatch.setattr(
            notion_extractor.NotionExtractor,
            "_get_access_token",
            classmethod(lambda cls, tenant_id, credential_id: (_ for _ in ()).throw(Exception("credential error"))),
        )
        monkeypatch.setattr(notion_extractor.dify_config, "NOTION_INTEGRATION_TOKEN", "env-token", raising=False)

        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            credential_id="cred",
        )

        assert extractor._notion_access_token == "env-token"

    def test_init_raises_if_no_credential_and_no_env_token(self, monkeypatch):
        monkeypatch.setattr(
            notion_extractor.NotionExtractor,
            "_get_access_token",
            classmethod(lambda cls, tenant_id, credential_id: (_ for _ in ()).throw(Exception("credential error"))),
        )
        monkeypatch.setattr(notion_extractor.dify_config, "NOTION_INTEGRATION_TOKEN", None, raising=False)

        with pytest.raises(ValueError, match="Must specify `integration_token`"):
            notion_extractor.NotionExtractor(
                notion_workspace_id="ws",
                notion_obj_id="obj",
                notion_page_type="page",
                tenant_id="tenant",
                credential_id="cred",
            )

    def test_extract_updates_last_edited_and_loads_documents(self, monkeypatch):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        update_mock = mock.Mock()
        load_mock = mock.Mock(return_value=[SimpleNamespace(page_content="doc")])
        monkeypatch.setattr(extractor, "update_last_edited_time", update_mock)
        monkeypatch.setattr(extractor, "_load_data_as_documents", load_mock)

        docs = extractor.extract()

        update_mock.assert_called_once_with(None)
        load_mock.assert_called_once_with("obj", "page")
        assert len(docs) == 1

    def test_load_data_as_documents_page_database_and_invalid(self, monkeypatch):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        monkeypatch.setattr(extractor, "_get_notion_block_data", lambda _: ["line1", "line2"])
        page_docs = extractor._load_data_as_documents("page-id", "page")
        assert page_docs[0].page_content == "line1\nline2"

        monkeypatch.setattr(extractor, "_get_notion_database_data", lambda _: [SimpleNamespace(page_content="db")])
        db_docs = extractor._load_data_as_documents("db-id", "database")
        assert db_docs[0].page_content == "db"

        with pytest.raises(ValueError, match="notion page type not supported"):
            extractor._load_data_as_documents("obj", "unsupported")


class TestNotionDatabase:
    def test_get_notion_database_data_parses_property_types_and_pagination(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="database",
            tenant_id="tenant",
            notion_access_token="token",
        )

        first_page = {
            "results": [
                {
                    "properties": {
                        "tags": {
                            "type": "multi_select",
                            "multi_select": [{"name": "A"}, {"name": "B"}],
                        },
                        "title_prop": {"type": "title", "title": [{"plain_text": "Title"}]},
                        "empty_title": {"type": "title", "title": []},
                        "rich": {"type": "rich_text", "rich_text": [{"plain_text": "RichText"}]},
                        "empty_rich": {"type": "rich_text", "rich_text": []},
                        "select_prop": {"type": "select", "select": {"name": "Selected"}},
                        "empty_select": {"type": "select", "select": None},
                        "status_prop": {"type": "status", "status": {"name": "Open"}},
                        "empty_status": {"type": "status", "status": None},
                        "number_prop": {"type": "number", "number": 10},
                        "dict_prop": {"type": "date", "date": {"start": "2024-01-01", "end": None}},
                    },
                    "url": "https://notion.so/page-1",
                }
            ],
            "has_more": True,
            "next_cursor": "cursor-2",
        }
        second_page = {"results": [], "has_more": False, "next_cursor": None}

        mock_post = mocker.patch("httpx.post", side_effect=[_mock_response(first_page), _mock_response(second_page)])

        docs = extractor._get_notion_database_data("db-1", query_dict={"filter": {"x": 1}})

        assert len(docs) == 1
        content = docs[0].page_content
        assert "tags:['A', 'B']" in content
        assert "title_prop:Title" in content
        assert "rich:RichText" in content
        assert "number_prop:10" in content
        assert "dict_prop:start:2024-01-01" in content
        assert "Row Page URL:https://notion.so/page-1" in content
        assert mock_post.call_count == 2

    def test_get_notion_database_data_handles_missing_results_and_empty_content(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="database",
            tenant_id="tenant",
            notion_access_token="token",
        )

        mocker.patch("httpx.post", return_value=_mock_response({"results": None}))
        assert extractor._get_notion_database_data("db-1") == []

    def test_get_notion_database_data_requires_access_token(self):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="database",
            tenant_id="tenant",
            notion_access_token="token",
        )
        extractor._notion_access_token = None

        with pytest.raises(AssertionError, match="Notion access token is required"):
            extractor._get_notion_database_data("db-1")


class TestNotionBlocks:
    def test_get_notion_block_data_success_with_table_headings_children_and_pagination(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        first_response = {
            "results": [
                {"type": "table", "id": "tbl-1", "has_children": False, "table": {}},
                {
                    "type": "heading_1",
                    "id": "h1",
                    "has_children": False,
                    "heading_1": {"rich_text": [{"text": {"content": "Heading"}}]},
                },
                {
                    "type": "paragraph",
                    "id": "p1",
                    "has_children": True,
                    "paragraph": {"rich_text": [{"text": {"content": "Paragraph"}}]},
                },
                {
                    "type": "child_page",
                    "id": "cp1",
                    "has_children": True,
                    "child_page": {"rich_text": []},
                },
            ],
            "next_cursor": "cursor-2",
        }
        second_response = {
            "results": [
                {
                    "type": "heading_2",
                    "id": "h2",
                    "has_children": False,
                    "heading_2": {"rich_text": [{"text": {"content": "SubHeading"}}]},
                }
            ],
            "next_cursor": None,
        }

        mocker.patch("httpx.request", side_effect=[_mock_response(first_response), _mock_response(second_response)])
        mocker.patch.object(extractor, "_read_table_rows", return_value="TABLE")
        mocker.patch.object(extractor, "_read_block", return_value="CHILD")

        lines = extractor._get_notion_block_data("page-1")

        assert lines[0] == "TABLE\n\n"
        assert "# Heading" in lines[1]
        assert "Paragraph\nCHILD\n\n" in lines[2]
        assert "## SubHeading" in lines[-1]

    def test_get_notion_block_data_handles_http_error_and_invalid_payload(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        mocker.patch("httpx.request", side_effect=httpx.HTTPError("network"))
        with pytest.raises(ValueError, match="Error fetching Notion block data"):
            extractor._get_notion_block_data("page-1")

        mocker.patch("httpx.request", return_value=_mock_response({"bad": "payload"}, status_code=200))
        with pytest.raises(ValueError, match="Error fetching Notion block data"):
            extractor._get_notion_block_data("page-1")

        mocker.patch("httpx.request", return_value=_mock_response({"results": []}, status_code=500, text="boom"))
        with pytest.raises(ValueError, match="Error fetching Notion block data: boom"):
            extractor._get_notion_block_data("page-1")

    def test_read_block_supports_heading_table_and_recursion(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        root_payload = {
            "results": [
                {
                    "type": "heading_2",
                    "id": "h2",
                    "has_children": False,
                    "heading_2": {"rich_text": [{"text": {"content": "Root"}}]},
                },
                {
                    "type": "paragraph",
                    "id": "child-block",
                    "has_children": True,
                    "paragraph": {"rich_text": [{"text": {"content": "Parent"}}]},
                },
                {"type": "table", "id": "tbl-1", "has_children": False, "table": {}},
            ],
            "next_cursor": None,
        }
        child_payload = {
            "results": [
                {
                    "type": "paragraph",
                    "id": "leaf",
                    "has_children": False,
                    "paragraph": {"rich_text": [{"text": {"content": "Child"}}]},
                }
            ],
            "next_cursor": None,
        }

        mocker.patch("httpx.request", side_effect=[_mock_response(root_payload), _mock_response(child_payload)])
        mocker.patch.object(extractor, "_read_table_rows", return_value="TABLE-MD")

        content = extractor._read_block("root")

        assert "## Root" in content
        assert "Parent" in content
        assert "Child" in content
        assert "TABLE-MD" in content

    def test_read_block_breaks_on_missing_results(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )
        mocker.patch("httpx.request", return_value=_mock_response({"results": None, "next_cursor": None}))

        assert extractor._read_block("root") == ""

    def test_read_table_rows_formats_markdown_with_pagination(self, mocker: MockerFixture):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        page_one = {
            "results": [
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "H1"}}],
                            [{"text": {"content": "H2"}}],
                        ]
                    }
                },
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "R1C1"}}],
                            [{"text": {"content": "R1C2"}}],
                        ]
                    }
                },
            ],
            "next_cursor": "next",
        }
        page_two = {
            "results": [
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "H1"}}],
                            [],
                        ]
                    }
                },
                {
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "R2C1"}}],
                            [{"text": {"content": "R2C2"}}],
                        ]
                    }
                },
            ],
            "next_cursor": None,
        }

        mocker.patch("httpx.request", side_effect=[_mock_response(page_one), _mock_response(page_two)])

        markdown = extractor._read_table_rows("tbl-1")

        assert "| H1 | H2 |" in markdown
        assert "| R1C1 | R1C2 |" in markdown
        assert "| H1 |  |" in markdown
        assert "| R2C1 | R2C2 |" in markdown


class TestNotionMetadataAndCredentialMethods:
    def test_update_last_edited_time_no_document_model(self):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        assert extractor.update_last_edited_time(None) is None

    def test_update_last_edited_time_updates_document_and_commits(self, monkeypatch):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )

        class FakeDocumentModel:
            data_source_info = "data_source_info"
            id = "id"

        execute_calls = []

        class FakeUpdateStmt:
            def where(self, *args):
                return self

            def values(self, **kwargs):
                return self

        class FakeSession:
            committed = False

            def execute(self, stmt):
                execute_calls.append(stmt)

            def commit(self):
                self.committed = True

        fake_db = SimpleNamespace(session=FakeSession())
        monkeypatch.setattr(notion_extractor, "DocumentModel", FakeDocumentModel)
        monkeypatch.setattr(notion_extractor, "update", lambda model: FakeUpdateStmt())
        monkeypatch.setattr(notion_extractor, "db", fake_db)
        monkeypatch.setattr(extractor, "get_notion_last_edited_time", lambda: "2026-01-01T00:00:00.000Z")

        doc_model = SimpleNamespace(id="doc-1", data_source_info_dict={"source": "notion"})
        extractor.update_last_edited_time(doc_model)

        assert execute_calls
        assert fake_db.session.committed is True

    def test_get_notion_last_edited_time_uses_page_and_database_urls(self, mocker: MockerFixture):
        extractor_page = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="page-id",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )
        request_mock = mocker.patch(
            "httpx.request", return_value=_mock_response({"last_edited_time": "2025-05-01T00:00:00.000Z"})
        )

        assert extractor_page.get_notion_last_edited_time() == "2025-05-01T00:00:00.000Z"
        assert "pages/page-id" in request_mock.call_args[0][1]

        extractor_db = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="db-id",
            notion_page_type="database",
            tenant_id="tenant",
            notion_access_token="token",
        )
        request_mock = mocker.patch(
            "httpx.request", return_value=_mock_response({"last_edited_time": "2025-06-01T00:00:00.000Z"})
        )

        assert extractor_db.get_notion_last_edited_time() == "2025-06-01T00:00:00.000Z"
        assert "databases/db-id" in request_mock.call_args[0][1]

    def test_get_notion_last_edited_time_requires_access_token(self):
        extractor = notion_extractor.NotionExtractor(
            notion_workspace_id="ws",
            notion_obj_id="obj",
            notion_page_type="page",
            tenant_id="tenant",
            notion_access_token="token",
        )
        extractor._notion_access_token = None

        with pytest.raises(AssertionError, match="Notion access token is required"):
            extractor.get_notion_last_edited_time()

    def test_get_access_token_success_and_errors(self, monkeypatch):
        with pytest.raises(Exception, match="No credential id found"):
            notion_extractor.NotionExtractor._get_access_token("tenant", None)

        class FakeProviderServiceMissing:
            def get_datasource_credentials(self, **kwargs):
                return None

        monkeypatch.setattr(notion_extractor, "DatasourceProviderService", FakeProviderServiceMissing)
        with pytest.raises(Exception, match="No notion credential found"):
            notion_extractor.NotionExtractor._get_access_token("tenant", "cred")

        class FakeProviderServiceFound:
            def get_datasource_credentials(self, **kwargs):
                return {"integration_secret": "token-from-credential"}

        monkeypatch.setattr(notion_extractor, "DatasourceProviderService", FakeProviderServiceFound)

        assert notion_extractor.NotionExtractor._get_access_token("tenant", "cred") == "token-from-credential"

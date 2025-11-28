"""Comprehensive unit tests for Notion datasource provider.

This test module covers all aspects of the Notion provider including:
- Notion API integration with proper authentication
- Page retrieval (single pages and databases)
- Block content parsing (headings, paragraphs, tables, nested blocks)
- Authentication handling (OAuth tokens, integration tokens, credential management)
- Error handling for API failures
- Pagination handling for large datasets
- Last edited time tracking

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

import json
from typing import Any
from unittest.mock import Mock, patch

import httpx
import pytest

from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.datasource.online_document.online_document_provider import (
    OnlineDocumentDatasourcePluginProviderController,
)
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.models.document import Document


class TestNotionExtractorAuthentication:
    """Tests for Notion authentication handling.

    Covers:
    - OAuth token authentication
    - Integration token fallback
    - Credential retrieval from database
    - Missing credential error handling
    """

    @pytest.fixture
    def mock_document_model(self):
        """Mock DocumentModel for testing."""
        mock_doc = Mock()
        mock_doc.id = "test-doc-id"
        mock_doc.data_source_info_dict = {"last_edited_time": "2024-01-01T00:00:00.000Z"}
        return mock_doc

    def test_init_with_explicit_token(self, mock_document_model):
        """Test NotionExtractor initialization with explicit access token."""
        # Arrange & Act
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="explicit-token-abc",
            document_model=mock_document_model,
        )

        # Assert
        assert extractor._notion_access_token == "explicit-token-abc"
        assert extractor._notion_workspace_id == "workspace-123"
        assert extractor._notion_obj_id == "page-456"
        assert extractor._notion_page_type == "page"

    @patch("core.rag.extractor.notion_extractor.DatasourceProviderService")
    def test_init_with_credential_id(self, mock_service_class, mock_document_model):
        """Test NotionExtractor initialization with credential ID retrieval."""
        # Arrange
        mock_service = Mock()
        mock_service.get_datasource_credentials.return_value = {"integration_secret": "credential-token-xyz"}
        mock_service_class.return_value = mock_service

        # Act
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            credential_id="cred-123",
            document_model=mock_document_model,
        )

        # Assert
        assert extractor._notion_access_token == "credential-token-xyz"
        mock_service.get_datasource_credentials.assert_called_once_with(
            tenant_id="tenant-789",
            credential_id="cred-123",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )

    @patch("core.rag.extractor.notion_extractor.dify_config")
    @patch("core.rag.extractor.notion_extractor.NotionExtractor._get_access_token")
    def test_init_with_integration_token_fallback(self, mock_get_token, mock_config, mock_document_model):
        """Test NotionExtractor falls back to integration token when credential not found."""
        # Arrange
        mock_get_token.return_value = None
        mock_config.NOTION_INTEGRATION_TOKEN = "integration-token-fallback"

        # Act
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            credential_id="cred-123",
            document_model=mock_document_model,
        )

        # Assert
        assert extractor._notion_access_token == "integration-token-fallback"

    @patch("core.rag.extractor.notion_extractor.dify_config")
    @patch("core.rag.extractor.notion_extractor.NotionExtractor._get_access_token")
    def test_init_missing_credentials_raises_error(self, mock_get_token, mock_config, mock_document_model):
        """Test NotionExtractor raises error when no credentials available."""
        # Arrange
        mock_get_token.return_value = None
        mock_config.NOTION_INTEGRATION_TOKEN = None

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            NotionExtractor(
                notion_workspace_id="workspace-123",
                notion_obj_id="page-456",
                notion_page_type="page",
                tenant_id="tenant-789",
                credential_id="cred-123",
                document_model=mock_document_model,
            )
        assert "Must specify `integration_token`" in str(exc_info.value)


class TestNotionExtractorPageRetrieval:
    """Tests for Notion page retrieval functionality.

    Covers:
    - Single page retrieval
    - Database page retrieval with pagination
    - Block content extraction
    - Nested block handling
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    def _create_mock_response(self, data: dict[str, Any], status_code: int = 200) -> Mock:
        """Helper to create mock HTTP response."""
        response = Mock()
        response.status_code = status_code
        response.json.return_value = data
        response.text = json.dumps(data)
        return response

    def _create_block(
        self, block_id: str, block_type: str, text_content: str, has_children: bool = False
    ) -> dict[str, Any]:
        """Helper to create a Notion block structure."""
        return {
            "object": "block",
            "id": block_id,
            "type": block_type,
            "has_children": has_children,
            block_type: {
                "rich_text": [
                    {
                        "type": "text",
                        "text": {"content": text_content},
                        "plain_text": text_content,
                    }
                ]
            },
        }

    @patch("httpx.request")
    def test_get_notion_block_data_simple_page(self, mock_request, extractor):
        """Test retrieving simple page with basic blocks."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                self._create_block("block-1", "paragraph", "First paragraph"),
                self._create_block("block-2", "paragraph", "Second paragraph"),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = self._create_mock_response(mock_data)

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 2
        assert "First paragraph" in result[0]
        assert "Second paragraph" in result[1]
        mock_request.assert_called_once()

    @patch("httpx.request")
    def test_get_notion_block_data_with_headings(self, mock_request, extractor):
        """Test retrieving page with heading blocks."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                self._create_block("block-1", "heading_1", "Main Title"),
                self._create_block("block-2", "heading_2", "Subtitle"),
                self._create_block("block-3", "paragraph", "Content text"),
                self._create_block("block-4", "heading_3", "Sub-subtitle"),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = self._create_mock_response(mock_data)

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 4
        assert "# Main Title" in result[0]
        assert "## Subtitle" in result[1]
        assert "Content text" in result[2]
        assert "### Sub-subtitle" in result[3]

    @patch("httpx.request")
    def test_get_notion_block_data_with_pagination(self, mock_request, extractor):
        """Test retrieving page with paginated results."""
        # Arrange
        first_page = {
            "object": "list",
            "results": [self._create_block("block-1", "paragraph", "First page content")],
            "next_cursor": "cursor-abc",
            "has_more": True,
        }
        second_page = {
            "object": "list",
            "results": [self._create_block("block-2", "paragraph", "Second page content")],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.side_effect = [
            self._create_mock_response(first_page),
            self._create_mock_response(second_page),
        ]

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 2
        assert "First page content" in result[0]
        assert "Second page content" in result[1]
        assert mock_request.call_count == 2

    @patch("httpx.request")
    def test_get_notion_block_data_with_nested_blocks(self, mock_request, extractor):
        """Test retrieving page with nested block structure."""
        # Arrange
        # First call returns parent blocks
        parent_data = {
            "object": "list",
            "results": [
                self._create_block("block-1", "paragraph", "Parent block", has_children=True),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        # Second call returns child blocks
        child_data = {
            "object": "list",
            "results": [
                self._create_block("block-child-1", "paragraph", "Child block"),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.side_effect = [
            self._create_mock_response(parent_data),
            self._create_mock_response(child_data),
        ]

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 1
        assert "Parent block" in result[0]
        assert "Child block" in result[0]
        assert mock_request.call_count == 2

    @patch("httpx.request")
    def test_get_notion_block_data_error_handling(self, mock_request, extractor):
        """Test error handling for failed API requests."""
        # Arrange
        mock_request.return_value = self._create_mock_response({}, status_code=404)

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)

    @patch("httpx.request")
    def test_get_notion_block_data_invalid_response(self, mock_request, extractor):
        """Test handling of invalid API response structure."""
        # Arrange
        mock_request.return_value = self._create_mock_response({"invalid": "structure"})

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)

    @patch("httpx.request")
    def test_get_notion_block_data_http_error(self, mock_request, extractor):
        """Test handling of HTTP errors during request."""
        # Arrange
        mock_request.side_effect = httpx.HTTPError("Network error")

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)


class TestNotionExtractorDatabaseRetrieval:
    """Tests for Notion database retrieval functionality.

    Covers:
    - Database query with pagination
    - Property extraction (title, rich_text, select, multi_select, etc.)
    - Row formatting
    - Empty database handling
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="database-789",
            notion_page_type="database",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    def _create_database_page(self, page_id: str, properties: dict[str, Any]) -> dict[str, Any]:
        """Helper to create a database page structure."""
        formatted_properties = {}
        for prop_name, prop_data in properties.items():
            prop_type = prop_data["type"]
            formatted_properties[prop_name] = {"type": prop_type, prop_type: prop_data["value"]}
        return {
            "object": "page",
            "id": page_id,
            "properties": formatted_properties,
            "url": f"https://notion.so/{page_id}",
        }

    @patch("httpx.post")
    def test_get_notion_database_data_simple(self, mock_post, extractor):
        """Test retrieving simple database with basic properties."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page(
                    "page-1",
                    {
                        "Title": {"type": "title", "value": [{"plain_text": "Task 1"}]},
                        "Status": {"type": "select", "value": {"name": "In Progress"}},
                    },
                ),
                self._create_database_page(
                    "page-2",
                    {
                        "Title": {"type": "title", "value": [{"plain_text": "Task 2"}]},
                        "Status": {"type": "select", "value": {"name": "Done"}},
                    },
                ),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Task 1" in content
        assert "Status:In Progress" in content
        assert "Title:Task 2" in content
        assert "Status:Done" in content

    @patch("httpx.post")
    def test_get_notion_database_data_with_pagination(self, mock_post, extractor):
        """Test retrieving database with paginated results."""
        # Arrange
        first_response = Mock()
        first_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page("page-1", {"Title": {"type": "title", "value": [{"plain_text": "Page 1"}]}}),
            ],
            "has_more": True,
            "next_cursor": "cursor-xyz",
        }
        second_response = Mock()
        second_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page("page-2", {"Title": {"type": "title", "value": [{"plain_text": "Page 2"}]}}),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.side_effect = [first_response, second_response]

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Page 1" in content
        assert "Title:Page 2" in content
        assert mock_post.call_count == 2

    @patch("httpx.post")
    def test_get_notion_database_data_multi_select(self, mock_post, extractor):
        """Test database with multi_select property type."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page(
                    "page-1",
                    {
                        "Title": {"type": "title", "value": [{"plain_text": "Project"}]},
                        "Tags": {
                            "type": "multi_select",
                            "value": [{"name": "urgent"}, {"name": "frontend"}],
                        },
                    },
                ),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Project" in content
        assert "Tags:" in content

    @patch("httpx.post")
    def test_get_notion_database_data_empty_properties(self, mock_post, extractor):
        """Test database with empty property values."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page(
                    "page-1",
                    {
                        "Title": {"type": "title", "value": []},
                        "Status": {"type": "select", "value": None},
                    },
                ),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        # Empty properties should be filtered out
        content = result[0].page_content
        assert "Row Page URL:" in content

    @patch("httpx.post")
    def test_get_notion_database_data_empty_results(self, mock_post, extractor):
        """Test handling of empty database."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 0

    @patch("httpx.post")
    def test_get_notion_database_data_missing_results(self, mock_post, extractor):
        """Test handling of malformed API response."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {"object": "list"}
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 0


class TestNotionExtractorTableParsing:
    """Tests for Notion table block parsing.

    Covers:
    - Table header extraction
    - Table row parsing
    - Markdown table formatting
    - Empty cell handling
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    @patch("httpx.request")
    def test_read_table_rows_simple(self, mock_request, extractor):
        """Test reading simple table with headers and rows."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "Name"}}],
                            [{"text": {"content": "Age"}}],
                        ]
                    },
                },
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "Alice"}}],
                            [{"text": {"content": "30"}}],
                        ]
                    },
                },
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {
                        "cells": [
                            [{"text": {"content": "Bob"}}],
                            [{"text": {"content": "25"}}],
                        ]
                    },
                },
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(json=lambda: mock_data)

        # Act
        result = extractor._read_table_rows("table-block-123")

        # Assert
        assert "| Name | Age |" in result
        assert "| --- | --- |" in result
        assert "| Alice | 30 |" in result
        assert "| Bob | 25 |" in result

    @patch("httpx.request")
    def test_read_table_rows_with_empty_cells(self, mock_request, extractor):
        """Test reading table with empty cells."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": "Col1"}}], [{"text": {"content": "Col2"}}]]},
                },
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": "Value1"}}], []]},
                },
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(json=lambda: mock_data)

        # Act
        result = extractor._read_table_rows("table-block-123")

        # Assert
        assert "| Col1 | Col2 |" in result
        assert "| --- | --- |" in result
        # Empty cells are handled by the table parsing logic
        assert "Value1" in result

    @patch("httpx.request")
    def test_read_table_rows_with_pagination(self, mock_request, extractor):
        """Test reading table with paginated results."""
        # Arrange
        first_page = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": "Header"}}]]},
                },
            ],
            "next_cursor": "cursor-abc",
            "has_more": True,
        }
        second_page = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": "Row1"}}]]},
                },
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.side_effect = [Mock(json=lambda: first_page), Mock(json=lambda: second_page)]

        # Act
        result = extractor._read_table_rows("table-block-123")

        # Assert
        assert "| Header |" in result
        assert mock_request.call_count == 2


class TestNotionExtractorLastEditedTime:
    """Tests for last edited time tracking.

    Covers:
    - Page last edited time retrieval
    - Database last edited time retrieval
    - Document model update
    """

    @pytest.fixture
    def mock_document_model(self):
        """Mock DocumentModel for testing."""
        mock_doc = Mock()
        mock_doc.id = "test-doc-id"
        mock_doc.data_source_info_dict = {"last_edited_time": "2024-01-01T00:00:00.000Z"}
        return mock_doc

    @pytest.fixture
    def extractor_page(self, mock_document_model):
        """Create a NotionExtractor instance for page testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
            document_model=mock_document_model,
        )

    @pytest.fixture
    def extractor_database(self, mock_document_model):
        """Create a NotionExtractor instance for database testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="database-789",
            notion_page_type="database",
            tenant_id="tenant-789",
            notion_access_token="test-token",
            document_model=mock_document_model,
        )

    @patch("httpx.request")
    def test_get_notion_last_edited_time_page(self, mock_request, extractor_page):
        """Test retrieving last edited time for a page."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "page",
            "id": "page-456",
            "last_edited_time": "2024-11-27T12:00:00.000Z",
        }
        mock_request.return_value = mock_response

        # Act
        result = extractor_page.get_notion_last_edited_time()

        # Assert
        assert result == "2024-11-27T12:00:00.000Z"
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert "pages/page-456" in call_args[0][1]

    @patch("httpx.request")
    def test_get_notion_last_edited_time_database(self, mock_request, extractor_database):
        """Test retrieving last edited time for a database."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "database",
            "id": "database-789",
            "last_edited_time": "2024-11-27T15:30:00.000Z",
        }
        mock_request.return_value = mock_response

        # Act
        result = extractor_database.get_notion_last_edited_time()

        # Assert
        assert result == "2024-11-27T15:30:00.000Z"
        mock_request.assert_called_once()
        call_args = mock_request.call_args
        assert "databases/database-789" in call_args[0][1]

    @patch("core.rag.extractor.notion_extractor.db")
    @patch("httpx.request")
    def test_update_last_edited_time(self, mock_request, mock_db, extractor_page, mock_document_model):
        """Test updating document model with last edited time."""
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "page",
            "id": "page-456",
            "last_edited_time": "2024-11-27T18:00:00.000Z",
        }
        mock_request.return_value = mock_response
        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query

        # Act
        extractor_page.update_last_edited_time(mock_document_model)

        # Assert
        assert mock_document_model.data_source_info_dict["last_edited_time"] == "2024-11-27T18:00:00.000Z"
        mock_db.session.commit.assert_called_once()

    def test_update_last_edited_time_no_document(self, extractor_page):
        """Test update_last_edited_time with None document model."""
        # Act & Assert - should not raise error
        extractor_page.update_last_edited_time(None)


class TestNotionExtractorIntegration:
    """Integration tests for complete extraction workflow.

    Covers:
    - Full page extraction workflow
    - Full database extraction workflow
    - Document creation
    - Error handling in extract method
    """

    @pytest.fixture
    def mock_document_model(self):
        """Mock DocumentModel for testing."""
        mock_doc = Mock()
        mock_doc.id = "test-doc-id"
        mock_doc.data_source_info_dict = {"last_edited_time": "2024-01-01T00:00:00.000Z"}
        return mock_doc

    @patch("core.rag.extractor.notion_extractor.db")
    @patch("httpx.request")
    def test_extract_page_complete_workflow(self, mock_request, mock_db, mock_document_model):
        """Test complete page extraction workflow."""
        # Arrange
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
            document_model=mock_document_model,
        )

        # Mock last edited time request
        last_edited_response = Mock()
        last_edited_response.json.return_value = {
            "object": "page",
            "last_edited_time": "2024-11-27T20:00:00.000Z",
        }

        # Mock block data request
        block_response = Mock()
        block_response.status_code = 200
        block_response.json.return_value = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "id": "block-1",
                    "type": "heading_1",
                    "has_children": False,
                    "heading_1": {
                        "rich_text": [{"type": "text", "text": {"content": "Test Page"}, "plain_text": "Test Page"}]
                    },
                },
                {
                    "object": "block",
                    "id": "block-2",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {
                        "rich_text": [
                            {"type": "text", "text": {"content": "Test content"}, "plain_text": "Test content"}
                        ]
                    },
                },
            ],
            "next_cursor": None,
            "has_more": False,
        }

        mock_request.side_effect = [last_edited_response, block_response]
        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query

        # Act
        documents = extractor.extract()

        # Assert
        assert len(documents) == 1
        assert isinstance(documents[0], Document)
        assert "# Test Page" in documents[0].page_content
        assert "Test content" in documents[0].page_content

    @patch("core.rag.extractor.notion_extractor.db")
    @patch("httpx.post")
    @patch("httpx.request")
    def test_extract_database_complete_workflow(self, mock_request, mock_post, mock_db, mock_document_model):
        """Test complete database extraction workflow."""
        # Arrange
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="database-789",
            notion_page_type="database",
            tenant_id="tenant-789",
            notion_access_token="test-token",
            document_model=mock_document_model,
        )

        # Mock last edited time request
        last_edited_response = Mock()
        last_edited_response.json.return_value = {
            "object": "database",
            "last_edited_time": "2024-11-27T20:00:00.000Z",
        }
        mock_request.return_value = last_edited_response

        # Mock database query request
        database_response = Mock()
        database_response.json.return_value = {
            "object": "list",
            "results": [
                {
                    "object": "page",
                    "id": "page-1",
                    "properties": {
                        "Name": {"type": "title", "title": [{"plain_text": "Item 1"}]},
                        "Status": {"type": "select", "select": {"name": "Active"}},
                    },
                    "url": "https://notion.so/page-1",
                }
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = database_response

        mock_query = Mock()
        mock_db.session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query

        # Act
        documents = extractor.extract()

        # Assert
        assert len(documents) == 1
        assert isinstance(documents[0], Document)
        assert "Name:Item 1" in documents[0].page_content
        assert "Status:Active" in documents[0].page_content

    def test_extract_invalid_page_type(self):
        """Test extract with invalid page type."""
        # Arrange
        extractor = NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="invalid-456",
            notion_page_type="invalid_type",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor.extract()
        assert "notion page type not supported" in str(exc_info.value)


class TestNotionExtractorReadBlock:
    """Tests for nested block reading functionality.

    Covers:
    - Recursive block reading
    - Indentation handling
    - Child page handling
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for testing."""
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    @patch("httpx.request")
    def test_read_block_with_indentation(self, mock_request, extractor):
        """Test reading nested blocks with proper indentation."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "id": "block-1",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {
                        "rich_text": [
                            {"type": "text", "text": {"content": "Nested content"}, "plain_text": "Nested content"}
                        ]
                    },
                }
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(json=lambda: mock_data)

        # Act
        result = extractor._read_block("block-parent", num_tabs=2)

        # Assert
        assert "\t\tNested content" in result

    @patch("httpx.request")
    def test_read_block_skip_child_page(self, mock_request, extractor):
        """Test that child_page blocks don't recurse."""
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "id": "block-1",
                    "type": "child_page",
                    "has_children": True,
                    "child_page": {"title": "Child Page"},
                }
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(json=lambda: mock_data)

        # Act
        result = extractor._read_block("block-parent")

        # Assert
        # Should only be called once (no recursion for child_page)
        assert mock_request.call_count == 1


class TestNotionProviderController:
    """Tests for Notion datasource provider controller integration.

    Covers:
    - Provider initialization
    - Datasource retrieval
    - Provider type verification
    """

    @pytest.fixture
    def mock_entity(self):
        """Mock provider entity for testing."""
        entity = Mock()
        entity.identity.name = "notion_datasource"
        entity.identity.icon = "notion-icon.png"
        entity.credentials_schema = []
        entity.datasources = []
        return entity

    def test_provider_controller_initialization(self, mock_entity):
        """Test OnlineDocumentDatasourcePluginProviderController initialization."""
        # Act
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id="langgenius/notion_datasource",
            plugin_unique_identifier="notion-unique-id",
            tenant_id="tenant-123",
        )

        # Assert
        assert controller.plugin_id == "langgenius/notion_datasource"
        assert controller.plugin_unique_identifier == "notion-unique-id"
        assert controller.tenant_id == "tenant-123"
        assert controller.provider_type == DatasourceProviderType.ONLINE_DOCUMENT

    def test_provider_controller_get_datasource(self, mock_entity):
        """Test retrieving datasource from controller."""
        # Arrange
        mock_datasource_entity = Mock()
        mock_datasource_entity.identity.name = "notion_datasource"
        mock_entity.datasources = [mock_datasource_entity]

        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id="langgenius/notion_datasource",
            plugin_unique_identifier="notion-unique-id",
            tenant_id="tenant-123",
        )

        # Act
        datasource = controller.get_datasource("notion_datasource")

        # Assert
        assert datasource is not None
        assert datasource.tenant_id == "tenant-123"

    def test_provider_controller_datasource_not_found(self, mock_entity):
        """Test error when datasource not found."""
        # Arrange
        mock_entity.datasources = []
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id="langgenius/notion_datasource",
            plugin_unique_identifier="notion-unique-id",
            tenant_id="tenant-123",
        )

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            controller.get_datasource("nonexistent_datasource")
        assert "not found" in str(exc_info.value)


class TestNotionExtractorAdvancedBlockTypes:
    """Tests for advanced Notion block types and edge cases.

    Covers:
    - Various block types (code, quote, lists, toggle, callout)
    - Empty blocks
    - Multiple rich text elements
    - Mixed block types in realistic scenarios
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for testing.

        Returns:
            NotionExtractor: Configured extractor with test credentials
        """
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    def _create_block_with_rich_text(
        self, block_id: str, block_type: str, rich_text_items: list[str], has_children: bool = False
    ) -> dict[str, Any]:
        """Helper to create a Notion block with multiple rich text elements.

        Args:
            block_id: Unique identifier for the block
            block_type: Type of block (paragraph, heading_1, etc.)
            rich_text_items: List of text content strings
            has_children: Whether the block has child blocks

        Returns:
            dict: Notion block structure with rich text elements
        """
        rich_text_array = [{"type": "text", "text": {"content": text}, "plain_text": text} for text in rich_text_items]
        return {
            "object": "block",
            "id": block_id,
            "type": block_type,
            "has_children": has_children,
            block_type: {"rich_text": rich_text_array},
        }

    @patch("httpx.request")
    def test_get_notion_block_data_with_list_blocks(self, mock_request, extractor):
        """Test retrieving page with bulleted and numbered list items.

        Both list types should be extracted with their content.
        """
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                self._create_block_with_rich_text("block-1", "bulleted_list_item", ["Bullet item"]),
                self._create_block_with_rich_text("block-2", "numbered_list_item", ["Numbered item"]),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(status_code=200, json=lambda: mock_data)

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 2
        assert "Bullet item" in result[0]
        assert "Numbered item" in result[1]

    @patch("httpx.request")
    def test_get_notion_block_data_with_special_blocks(self, mock_request, extractor):
        """Test retrieving page with code, quote, and callout blocks.

        Special block types should preserve their content correctly.
        """
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                self._create_block_with_rich_text("block-1", "code", ["print('code')"]),
                self._create_block_with_rich_text("block-2", "quote", ["Quoted text"]),
                self._create_block_with_rich_text("block-3", "callout", ["Important note"]),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(status_code=200, json=lambda: mock_data)

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 3
        assert "print('code')" in result[0]
        assert "Quoted text" in result[1]
        assert "Important note" in result[2]

    @patch("httpx.request")
    def test_get_notion_block_data_with_toggle_block(self, mock_request, extractor):
        """Test retrieving page with toggle block containing children.

        Toggle blocks can have nested content that should be extracted.
        """
        # Arrange
        parent_data = {
            "object": "list",
            "results": [
                self._create_block_with_rich_text("block-1", "toggle", ["Toggle header"], has_children=True),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        child_data = {
            "object": "list",
            "results": [
                self._create_block_with_rich_text("block-child-1", "paragraph", ["Hidden content"]),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.side_effect = [
            Mock(status_code=200, json=lambda: parent_data),
            Mock(status_code=200, json=lambda: child_data),
        ]

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 1
        assert "Toggle header" in result[0]
        assert "Hidden content" in result[0]

    @patch("httpx.request")
    def test_get_notion_block_data_mixed_block_types(self, mock_request, extractor):
        """Test retrieving page with mixed block types.

        Real Notion pages contain various block types mixed together.
        This tests a realistic scenario with multiple block types.
        """
        # Arrange
        mock_data = {
            "object": "list",
            "results": [
                self._create_block_with_rich_text("block-1", "heading_1", ["Project Documentation"]),
                self._create_block_with_rich_text("block-2", "paragraph", ["This is an introduction."]),
                self._create_block_with_rich_text("block-3", "heading_2", ["Features"]),
                self._create_block_with_rich_text("block-4", "bulleted_list_item", ["Feature A"]),
                self._create_block_with_rich_text("block-5", "code", ["npm install package"]),
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(status_code=200, json=lambda: mock_data)

        # Act
        result = extractor._get_notion_block_data("page-456")

        # Assert
        assert len(result) == 5
        assert "# Project Documentation" in result[0]
        assert "This is an introduction" in result[1]
        assert "## Features" in result[2]
        assert "Feature A" in result[3]
        assert "npm install package" in result[4]


class TestNotionExtractorDatabaseAdvanced:
    """Tests for advanced database scenarios and property types.

    Covers:
    - Various property types (date, number, checkbox, url, email, phone, status)
    - Rich text properties
    - Large database pagination
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for database testing.

        Returns:
            NotionExtractor: Configured extractor for database operations
        """
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="database-789",
            notion_page_type="database",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    def _create_database_page_with_properties(self, page_id: str, properties: dict[str, Any]) -> dict[str, Any]:
        """Helper to create a database page with various property types.

        Args:
            page_id: Unique identifier for the page
            properties: Dictionary of property names to property configurations

        Returns:
            dict: Notion database page structure
        """
        formatted_properties = {}
        for prop_name, prop_data in properties.items():
            prop_type = prop_data["type"]
            formatted_properties[prop_name] = {"type": prop_type, prop_type: prop_data["value"]}
        return {
            "object": "page",
            "id": page_id,
            "properties": formatted_properties,
            "url": f"https://notion.so/{page_id}",
        }

    @patch("httpx.post")
    def test_get_notion_database_data_with_various_property_types(self, mock_post, extractor):
        """Test database with multiple property types.

        Tests date, number, checkbox, URL, email, phone, and status properties.
        All property types should be extracted correctly.
        """
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page_with_properties(
                    "page-1",
                    {
                        "Title": {"type": "title", "value": [{"plain_text": "Test Entry"}]},
                        "Date": {"type": "date", "value": {"start": "2024-11-27", "end": None}},
                        "Price": {"type": "number", "value": 99.99},
                        "Completed": {"type": "checkbox", "value": True},
                        "Link": {"type": "url", "value": "https://example.com"},
                        "Email": {"type": "email", "value": "test@example.com"},
                        "Phone": {"type": "phone_number", "value": "+1-555-0123"},
                        "Status": {"type": "status", "value": {"name": "Active"}},
                    },
                ),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Test Entry" in content
        assert "Date:" in content
        assert "Price:99.99" in content
        assert "Completed:True" in content
        assert "Link:https://example.com" in content
        assert "Email:test@example.com" in content
        assert "Phone:+1-555-0123" in content
        assert "Status:Active" in content

    @patch("httpx.post")
    def test_get_notion_database_data_large_pagination(self, mock_post, extractor):
        """Test database with multiple pages of results.

        Large databases require multiple API calls with cursor-based pagination.
        This tests that all pages are retrieved correctly.
        """
        # Arrange - Create 3 pages of results
        page1_response = Mock()
        page1_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page_with_properties(
                    f"page-{i}", {"Title": {"type": "title", "value": [{"plain_text": f"Item {i}"}]}}
                )
                for i in range(1, 4)
            ],
            "has_more": True,
            "next_cursor": "cursor-1",
        }

        page2_response = Mock()
        page2_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page_with_properties(
                    f"page-{i}", {"Title": {"type": "title", "value": [{"plain_text": f"Item {i}"}]}}
                )
                for i in range(4, 7)
            ],
            "has_more": True,
            "next_cursor": "cursor-2",
        }

        page3_response = Mock()
        page3_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page_with_properties(
                    f"page-{i}", {"Title": {"type": "title", "value": [{"plain_text": f"Item {i}"}]}}
                )
                for i in range(7, 10)
            ],
            "has_more": False,
            "next_cursor": None,
        }

        mock_post.side_effect = [page1_response, page2_response, page3_response]

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        # Verify all items from all pages are present
        for i in range(1, 10):
            assert f"Title:Item {i}" in content
        # Verify pagination was called correctly
        assert mock_post.call_count == 3

    @patch("httpx.post")
    def test_get_notion_database_data_with_rich_text_property(self, mock_post, extractor):
        """Test database with rich_text property type.

        Rich text properties can contain formatted text and should be extracted.
        """
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                self._create_database_page_with_properties(
                    "page-1",
                    {
                        "Title": {"type": "title", "value": [{"plain_text": "Note"}]},
                        "Description": {
                            "type": "rich_text",
                            "value": [{"plain_text": "This is a detailed description"}],
                        },
                    },
                ),
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Act
        result = extractor._get_notion_database_data("database-789")

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Note" in content
        assert "Description:This is a detailed description" in content


class TestNotionExtractorErrorScenarios:
    """Tests for error handling and edge cases.

    Covers:
    - Network timeouts
    - Rate limiting
    - Invalid tokens
    - Malformed responses
    - Missing required fields
    - API version mismatches
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for error testing.

        Returns:
            NotionExtractor: Configured extractor for error scenarios
        """
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    @pytest.mark.parametrize(
        ("error_type", "error_value"),
        [
            ("timeout", httpx.TimeoutException("Request timed out")),
            ("connection", httpx.ConnectError("Connection failed")),
        ],
    )
    @patch("httpx.request")
    def test_get_notion_block_data_network_errors(self, mock_request, extractor, error_type, error_value):
        """Test handling of various network errors.

        Network issues (timeouts, connection failures) should raise appropriate errors.
        """
        # Arrange
        mock_request.side_effect = error_value

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)

    @pytest.mark.parametrize(
        ("status_code", "description"),
        [
            (401, "Unauthorized"),
            (403, "Forbidden"),
            (404, "Not Found"),
            (429, "Rate limit exceeded"),
        ],
    )
    @patch("httpx.request")
    def test_get_notion_block_data_http_status_errors(self, mock_request, extractor, status_code, description):
        """Test handling of various HTTP status errors.

        Different HTTP error codes (401, 403, 404, 429) should be handled appropriately.
        """
        # Arrange
        mock_response = Mock()
        mock_response.status_code = status_code
        mock_response.text = description
        mock_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)

    @pytest.mark.parametrize(
        ("response_data", "description"),
        [
            ({"object": "list"}, "missing results field"),
            ({"object": "list", "results": "not a list"}, "results not a list"),
            ({"object": "list", "results": None}, "results is None"),
        ],
    )
    @patch("httpx.request")
    def test_get_notion_block_data_malformed_responses(self, mock_request, extractor, response_data, description):
        """Test handling of malformed API responses.

        Various malformed responses should be handled gracefully.
        """
        # Arrange
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = response_data
        mock_request.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            extractor._get_notion_block_data("page-456")
        assert "Error fetching Notion block data" in str(exc_info.value)

    @patch("httpx.post")
    def test_get_notion_database_data_with_query_filter(self, mock_post, extractor):
        """Test database query with custom filter.

        Databases can be queried with filters to retrieve specific rows.
        """
        # Arrange
        mock_response = Mock()
        mock_response.json.return_value = {
            "object": "list",
            "results": [
                {
                    "object": "page",
                    "id": "page-1",
                    "properties": {
                        "Title": {"type": "title", "title": [{"plain_text": "Filtered Item"}]},
                        "Status": {"type": "select", "select": {"name": "Active"}},
                    },
                    "url": "https://notion.so/page-1",
                }
            ],
            "has_more": False,
            "next_cursor": None,
        }
        mock_post.return_value = mock_response

        # Create a custom query filter
        query_filter = {"filter": {"property": "Status", "select": {"equals": "Active"}}}

        # Act
        result = extractor._get_notion_database_data("database-789", query_dict=query_filter)

        # Assert
        assert len(result) == 1
        content = result[0].page_content
        assert "Title:Filtered Item" in content
        assert "Status:Active" in content
        # Verify the filter was passed to the API
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        assert "filter" in call_args[1]["json"]


class TestNotionExtractorTableAdvanced:
    """Tests for advanced table scenarios.

    Covers:
    - Tables with many columns
    - Tables with complex cell content
    - Empty tables
    """

    @pytest.fixture
    def extractor(self):
        """Create a NotionExtractor instance for table testing.

        Returns:
            NotionExtractor: Configured extractor for table operations
        """
        return NotionExtractor(
            notion_workspace_id="workspace-123",
            notion_obj_id="page-456",
            notion_page_type="page",
            tenant_id="tenant-789",
            notion_access_token="test-token",
        )

    @patch("httpx.request")
    def test_read_table_rows_with_many_columns(self, mock_request, extractor):
        """Test reading table with many columns.

        Tables can have numerous columns; all should be extracted correctly.
        """
        # Arrange - Create a table with 10 columns
        headers = [f"Col{i}" for i in range(1, 11)]
        values = [f"Val{i}" for i in range(1, 11)]

        mock_data = {
            "object": "list",
            "results": [
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": h}}] for h in headers]},
                },
                {
                    "object": "block",
                    "type": "table_row",
                    "table_row": {"cells": [[{"text": {"content": v}}] for v in values]},
                },
            ],
            "next_cursor": None,
            "has_more": False,
        }
        mock_request.return_value = Mock(json=lambda: mock_data)

        # Act
        result = extractor._read_table_rows("table-block-123")

        # Assert
        for header in headers:
            assert header in result
        for value in values:
            assert value in result
        # Verify markdown table structure
        assert "| --- |" in result

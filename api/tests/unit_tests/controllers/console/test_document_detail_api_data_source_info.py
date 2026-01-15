"""
Test for document detail API data_source_info serialization fix.

This test verifies that the document detail API returns both data_source_info
and data_source_detail_dict for all data_source_type values, including "local_file".
"""

import json
from typing import Generic, Literal, NotRequired, TypedDict, TypeVar, Union

from models.dataset import Document


class LocalFileInfo(TypedDict):
    file_path: str
    size: int
    created_at: NotRequired[str]


class UploadFileInfo(TypedDict):
    upload_file_id: str


class NotionImportInfo(TypedDict):
    notion_page_id: str
    workspace_id: str


class WebsiteCrawlInfo(TypedDict):
    url: str
    job_id: str


RawInfo = Union[LocalFileInfo, UploadFileInfo, NotionImportInfo, WebsiteCrawlInfo]
T_type = TypeVar("T_type", bound=str)
T_info = TypeVar("T_info", bound=Union[LocalFileInfo, UploadFileInfo, NotionImportInfo, WebsiteCrawlInfo])


class Case(TypedDict, Generic[T_type, T_info]):
    data_source_type: T_type
    data_source_info: str
    expected_raw: T_info


LocalFileCase = Case[Literal["local_file"], LocalFileInfo]
UploadFileCase = Case[Literal["upload_file"], UploadFileInfo]
NotionImportCase = Case[Literal["notion_import"], NotionImportInfo]
WebsiteCrawlCase = Case[Literal["website_crawl"], WebsiteCrawlInfo]

AnyCase = Union[LocalFileCase, UploadFileCase, NotionImportCase, WebsiteCrawlCase]


case_1: LocalFileCase = {
    "data_source_type": "local_file",
    "data_source_info": json.dumps({"file_path": "/tmp/test.txt", "size": 1024}),
    "expected_raw": {"file_path": "/tmp/test.txt", "size": 1024},
}


# ERROR: Expected LocalFileInfo, but got WebsiteCrawlInfo
case_2: LocalFileCase = {
    "data_source_type": "local_file",
    "data_source_info": "...",
    "expected_raw": {"file_path": "https://google.com", "size": 123},
}

cases: list[AnyCase] = [case_1]


class TestDocumentDetailDataSourceInfo:
    """Test cases for document detail API data_source_info serialization."""

    def test_data_source_info_dict_returns_raw_data(self):
        """Test that data_source_info_dict returns raw JSON data for all data_source_type values."""
        # Test data for different data_source_type values
        for case in cases:
            document = Document(
                data_source_type=case["data_source_type"],
                data_source_info=case["data_source_info"],
            )

            # Test data_source_info_dict (raw data)
            raw_result = document.data_source_info_dict
            assert raw_result == case["expected_raw"], f"Failed for {case['data_source_type']}"

            # Verify raw_result is always a valid dict
            assert isinstance(raw_result, dict)

    def test_local_file_data_source_info_without_db_context(self):
        """Test that local_file type data_source_info_dict works without database context."""
        test_data: LocalFileInfo = {
            "file_path": "/local/path/document.txt",
            "size": 512,
            "created_at": "2024-01-01T00:00:00Z",
        }

        document = Document(
            data_source_type="local_file",
            data_source_info=json.dumps(test_data),
        )

        # data_source_info_dict should return the raw data (this doesn't need DB context)
        raw_data = document.data_source_info_dict
        assert raw_data == test_data
        assert isinstance(raw_data, dict)

        # Verify the data contains expected keys for pipeline mode
        assert "file_path" in raw_data
        assert "size" in raw_data

    def test_notion_and_website_crawl_data_source_detail(self):
        """Test that notion_import and website_crawl return raw data in data_source_detail_dict."""
        # Test notion_import
        notion_data: NotionImportInfo = {"notion_page_id": "page-123", "workspace_id": "ws-456"}
        document = Document(
            data_source_type="notion_import",
            data_source_info=json.dumps(notion_data),
        )

        # data_source_detail_dict should return raw data for notion_import
        detail_result = document.data_source_detail_dict
        assert detail_result == notion_data

        # Test website_crawl
        website_data: WebsiteCrawlInfo = {"url": "https://example.com", "job_id": "job-789"}
        document = Document(
            data_source_type="website_crawl",
            data_source_info=json.dumps(website_data),
        )

        # data_source_detail_dict should return raw data for website_crawl
        detail_result = document.data_source_detail_dict
        assert detail_result == website_data

    def test_local_file_data_source_detail_dict_without_db(self):
        """Test that local_file returns empty data_source_detail_dict (this doesn't need DB context)."""
        # Test local_file - this should work without database context since it returns {} early
        document = Document(
            data_source_type="local_file",
            data_source_info=json.dumps({"file_path": "/tmp/test.txt"}),
        )

        # Should return empty dict for local_file type (handled in the model)
        detail_result = document.data_source_detail_dict
        assert detail_result == {}

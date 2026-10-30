from unittest.mock import create_autospec

import pytest

from services.data_source.watercrawl_client import WaterCrawlAPIClient
from services.data_source.watercrawl_provider import WaterCrawlProvider


class _RecordingWaterCrawlClient:
    def __init__(self, remote_status: str) -> None:
        self.remote_status = remote_status
        self.result_calls: list[str] = []

    def get_crawl_request(self, crawl_request_id: str) -> dict[str, object]:
        return {
            "uuid": crawl_request_id,
            "status": self.remote_status,
            "number_of_documents": 1,
            "options": {"spider_options": {"page_limit": 2}},
            "duration": None,
        }

    def get_crawl_request_results(
        self,
        crawl_request_id: str,
        _page: int,
        _page_size: int,
        _query_params: dict[str, object],
    ) -> dict[str, object]:
        self.result_calls.append(crawl_request_id)
        return {
            "results": [
                {
                    "url": "https://example.com/page",
                    "result": {
                        "markdown": "content",
                        "metadata": {"title": "Example", "description": "Description"},
                    },
                }
            ],
            "next": None,
        }


@pytest.mark.parametrize(
    ("remote_status", "public_status", "reads_results"),
    [
        ("new", "active", False),
        ("running", "active", False),
        ("finished", "completed", True),
        ("canceling", "error", False),
        ("canceled", "error", False),
        ("failed", "error", False),
    ],
)
def test_crawl_status_maps_all_watercrawl_states_and_reads_results_only_when_finished(
    remote_status: str,
    public_status: str,
    reads_results: bool,
) -> None:
    provider = WaterCrawlProvider(api_key="key")
    client = _RecordingWaterCrawlClient(remote_status)
    client_port = create_autospec(WaterCrawlAPIClient, instance=True, spec_set=True)
    client_port.get_crawl_request.side_effect = client.get_crawl_request
    client_port.get_crawl_request_results.side_effect = client.get_crawl_request_results
    provider.client = client_port

    result = provider.get_crawl_status("job-1")

    assert result["status"] == public_status
    assert result["data"] == (
        [
            {
                "title": "Example",
                "description": "Description",
                "source_url": "https://example.com/page",
                "markdown": "content",
            }
        ]
        if reads_results
        else []
    )
    assert client.result_calls == (["job-1"] if reads_results else [])


def test_crawl_status_rejects_unknown_state_without_reading_results() -> None:
    provider = WaterCrawlProvider(api_key="key")
    client = _RecordingWaterCrawlClient("unexpected")
    client_port = create_autospec(WaterCrawlAPIClient, instance=True, spec_set=True)
    client_port.get_crawl_request.side_effect = client.get_crawl_request
    client_port.get_crawl_request_results.side_effect = client.get_crawl_request_results
    provider.client = client_port

    with pytest.raises(ValueError, match="Unknown WaterCrawl status"):
        provider.get_crawl_status("job-1")

    assert client.result_calls == []

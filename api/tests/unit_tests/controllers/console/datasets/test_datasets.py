import datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch
from uuid import UUID

import pytest
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import services
from controllers.common.errors import InvalidArgumentError, NotFoundError
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets import datasets as controller
from controllers.console.datasets.datasets import (
    DatasetApi,
    DatasetApiBaseUrlApi,
    DatasetApiDeleteApi,
    DatasetApiKeyApi,
    DatasetAutoDisableLogApi,
    DatasetEnableApiApi,
    DatasetErrorDocs,
    DatasetIndexingEstimateApi,
    DatasetIndexingStatusApi,
    DatasetListApi,
    DatasetPermissionUserListApi,
    DatasetQueryApi,
    DatasetRelatedAppListApi,
    DatasetRetrievalSettingApi,
    DatasetRetrievalSettingMockApi,
    DatasetUpdatePayload,
    DatasetUseCheckApi,
    IndexingEstimatePayload,
    _new_estimate_sources,
)
from controllers.console.datasets.error import (
    DatasetAccessDeniedRequestError,
    DatasetInUseError,
    DatasetNameDuplicateError,
    IndexingEstimateError,
)
from machinery.context import RequestContext
from services.data_source.entities.notion_import import NotionPageType
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.datasets.application import (
    DatasetApplicationService,
    DatasetKeyLimitError,
    DatasetKeyNotFoundError,
    DatasetListFilter,
)
from services.knowledge.entities.indexing_estimate import (
    NotionEstimateSource,
    UploadFileEstimateSource,
    WebsiteEstimateSource,
)
from services.knowledge.indexing.estimate import (
    EstimateSourceNotFoundError,
    IndexingEstimateCredentialUnavailableError,
    IndexingEstimateExecutionError,
    IndexingEstimateProviderUnavailableError,
    UnsupportedEstimateSourceError,
)

CONTEXT = RequestContext("request-1", None, "account-1", "tenant-1")
DATASET_ID = UUID(int=1)


@pytest.fixture
def datasets(monkeypatch):
    service = create_autospec(DatasetApplicationService, instance=True, spec_set=True)
    monkeypatch.setattr(
        controller, "application_services", lambda: SimpleNamespace(knowledge=SimpleNamespace(datasets=service))
    )
    return service


@pytest.mark.parametrize(
    ("resource", "operation"),
    [
        (DatasetApi, "get_dataset"),
        (DatasetUseCheckApi, "is_in_use"),
        (DatasetQueryApi, "queries"),
        (DatasetRelatedAppListApi, "related_apps"),
        (DatasetIndexingStatusApi, "indexing_status"),
        (DatasetErrorDocs, "error_documents"),
        (DatasetPermissionUserListApi, "partial_members"),
        (DatasetAutoDisableLogApi, "auto_disable_logs"),
    ],
)
@pytest.mark.parametrize(
    ("error", "http_error"), [(DatasetNotFoundError(), NotFound), (DatasetAccessDeniedError(), Forbidden)]
)
def test_scoped_reads_pass_context_and_map_access_errors(app, datasets, resource, operation, error, http_error):
    method = getattr(datasets, operation)
    method.side_effect = error
    with app.test_request_context("/"), pytest.raises(http_error):
        unwrap(resource.get)(resource(), CONTEXT, DATASET_ID)
    assert method.call_args.args == (CONTEXT,)
    assert method.call_args.kwargs["dataset_id"] == str(DATASET_ID)


def test_list_parses_repeated_filters_and_serializes_page(app, datasets):
    datasets.list_datasets.return_value = {"data": [], "page": 2, "limit": 3, "total": 4, "has_more": False}
    with app.test_request_context("/?page=2&limit=3&ids=a&ids=b&tag_ids=x&tag_ids=y&include_all=true&keyword=term"):
        result, status = unwrap(DatasetListApi.get)(DatasetListApi(), CONTEXT)
    datasets.list_datasets.assert_called_once_with(
        CONTEXT,
        DatasetListFilter(page=2, limit=3, ids=["a", "b"], tag_ids=["x", "y"], include_all=True, keyword="term"),
    )
    assert status == 200
    assert result == datasets.list_datasets.return_value


def test_patch_does_not_turn_omitted_fields_into_updates(datasets):
    datasets.update_dataset.side_effect = DatasetNotFoundError()
    with pytest.raises(NotFound):
        unwrap(DatasetApi.patch)(DatasetApi(), DatasetUpdatePayload(name="Changed"), CONTEXT, DATASET_ID)
    datasets.update_dataset.assert_called_once_with(CONTEXT, dataset_id=str(DATASET_ID), values={"name": "Changed"})


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (services.errors.dataset.DatasetNameDuplicateError(), DatasetNameDuplicateError),
        (services.errors.dataset.DatasetInUseError(), DatasetInUseError),
    ],
)
def test_domain_errors_are_mapped_at_transport(datasets, error, http_error):
    datasets.delete_dataset.side_effect = error
    with pytest.raises(http_error):
        unwrap(DatasetApi.delete)(DatasetApi(), CONTEXT, DATASET_ID)


def test_delete_success_returns_empty_204(datasets):
    assert unwrap(DatasetApi.delete)(DatasetApi(), CONTEXT, DATASET_ID) == ("", 204)
    datasets.delete_dataset.assert_called_once_with(CONTEXT, dataset_id=str(DATASET_ID))


@pytest.mark.parametrize("values", ["dataset", 1, [None], [12]])
def test_invalid_key_scope_never_reaches_application(app, datasets, values):
    with app.test_request_context("/", json={"dataset_ids": values}), pytest.raises(BadRequest):
        unwrap(DatasetApiKeyApi.post)(DatasetApiKeyApi(), CONTEXT)
    datasets.create_key.assert_not_called()


@pytest.mark.parametrize(
    ("error", "custom"), [(DatasetKeyLimitError("limit"), "max_keys_exceeded"), (ValueError("unknown"), None)]
)
def test_key_creation_preserves_error_contract(app, datasets, error, custom):
    datasets.create_key.side_effect = error
    with app.test_request_context("/", json={}), pytest.raises(BadRequest) as raised:
        unwrap(DatasetApiKeyApi.post)(DatasetApiKeyApi(), CONTEXT)
    assert raised.value.data["message"] == str(error)
    assert raised.value.data.get("custom") == custom


def test_keys_are_serialized_with_scope_and_epoch_dates(app, datasets):
    datasets.create_key.return_value = {
        "id": "key-1",
        "type": "dataset",
        "token": "dataset-secret",
        "dataset_ids": ["a"],
        "created_at": datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
    }
    with app.test_request_context("/", json={"dataset_ids": ["a"]}):
        result, status = unwrap(DatasetApiKeyApi.post)(DatasetApiKeyApi(), CONTEXT)
    assert status == 200
    assert result["token"] == "dataset-secret"
    assert result["created_at"] == 1704067200
    assert result["dataset_ids"] == ["a"]


def test_delete_key_maps_missing_key(datasets):
    datasets.delete_key.side_effect = DatasetKeyNotFoundError("API key not found")
    with pytest.raises(NotFound) as raised:
        unwrap(DatasetApiDeleteApi.delete)(DatasetApiDeleteApi(), CONTEXT, DATASET_ID)
    assert raised.value.data["message"] == "API key not found"


def test_request_base_url_and_explicit_status_are_forwarded(app, datasets):
    datasets.api_base_url.return_value = "https://api.example/v1"
    with app.test_request_context("/", base_url="https://console.example/"):
        assert unwrap(DatasetApiBaseUrlApi.get)(DatasetApiBaseUrlApi(), CONTEXT) == {
            "api_base_url": "https://api.example/v1"
        }
    datasets.api_base_url.assert_called_once_with(CONTEXT, request_base_url="https://console.example")
    assert unwrap(DatasetEnableApiApi.post)(DatasetEnableApiApi(), CONTEXT, DATASET_ID, "disable") == (
        {"result": "success"},
        200,
    )
    datasets.set_api_enabled.assert_called_once_with(CONTEXT, dataset_id=str(DATASET_ID), status="disable")


def test_retrieval_settings_forward_mock_flag(datasets):
    datasets.retrieval_settings.return_value = {"retrieval_method": ["semantic_search"]}
    assert (
        unwrap(DatasetRetrievalSettingApi.get)(DatasetRetrievalSettingApi(), CONTEXT)
        == datasets.retrieval_settings.return_value
    )
    unwrap(DatasetRetrievalSettingMockApi.get)(DatasetRetrievalSettingMockApi(), CONTEXT, "milvus")
    datasets.retrieval_settings.assert_called_with(CONTEXT, vector_type="milvus", is_mock=True)


def test_new_estimate_sources_maps_each_supported_transport_shape() -> None:
    upload_sources = _new_estimate_sources(
        {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file-1", "file-2"]}}
    )
    notion_sources = _new_estimate_sources(
        {
            "data_source_type": "notion_import",
            "notion_info_list": [
                {
                    "workspace_id": "notion-workspace",
                    "credential_id": "credential-1",
                    "pages": [{"page_id": "page-1", "type": "page"}],
                }
            ],
        }
    )
    website_sources = _new_estimate_sources(
        {
            "data_source_type": "website_crawl",
            "website_info_list": {
                "provider": "firecrawl",
                "job_id": "job-1",
                "urls": ["https://example.com/a", "https://example.com/b"],
                "only_main_content": True,
            },
        }
    )

    assert upload_sources == (UploadFileEstimateSource("file-1"), UploadFileEstimateSource("file-2"))
    assert notion_sources == (NotionEstimateSource("notion-workspace", "page-1", NotionPageType.PAGE, "credential-1"),)
    assert website_sources == (
        WebsiteEstimateSource("firecrawl", "job-1", "https://example.com/a", only_main_content=True),
        WebsiteEstimateSource("firecrawl", "job-1", "https://example.com/b", only_main_content=True),
    )


@pytest.mark.parametrize(("value", "expected"), [("false", False), ("true", True), (False, False), (True, True)])
def test_website_estimate_parses_boolean_values(value: str | bool, expected: bool) -> None:
    sources = _new_estimate_sources(
        {
            "data_source_type": "website_crawl",
            "website_info_list": {
                "provider": "firecrawl",
                "job_id": "job-1",
                "urls": ["https://example.com"],
                "only_main_content": value,
            },
        }
    )
    assert sources == (WebsiteEstimateSource("firecrawl", "job-1", "https://example.com", only_main_content=expected),)


@pytest.mark.parametrize("values", [{"only_main_content": "invalid"}, {"urls": [42]}])
def test_website_estimate_rejects_invalid_field_types(values: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _new_estimate_sources(
            {
                "data_source_type": "website_crawl",
                "website_info_list": {
                    "provider": "firecrawl",
                    "job_id": "job-1",
                    "urls": ["https://example.com"],
                    **values,
                },
            }
        )


def test_new_estimate_sources_deduplicates_upload_ids_without_reordering() -> None:
    sources = _new_estimate_sources(
        {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file-2", "file-1", "file-2"]}}
    )

    assert sources == (UploadFileEstimateSource("file-2"), UploadFileEstimateSource("file-1"))


@pytest.mark.parametrize(
    "info_list",
    [
        {"data_source_type": "upload_file", "file_info_list": {}},
        {"data_source_type": "notion_import", "notion_info_list": [{"workspace_id": "workspace"}]},
        {
            "data_source_type": "notion_import",
            "notion_info_list": [
                {
                    "workspace_id": "workspace",
                    "credential_id": "credential",
                    "pages": [{"page_id": "page", "type": "unknown"}],
                }
            ],
        },
        {"data_source_type": "unsupported"},
    ],
)
def test_new_estimate_sources_rejects_malformed_transport_shapes(info_list: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _new_estimate_sources(info_list)


@pytest.mark.parametrize(
    ("error", "expected_http_error"),
    [
        (IndexingEstimateCredentialUnavailableError(), NotFoundError),
        (EstimateSourceNotFoundError("source-1"), NotFoundError),
        (DatasetNotFoundError(), NotFoundError),
        (DatasetAccessDeniedError(), DatasetAccessDeniedRequestError),
        (UnsupportedEstimateSourceError("unsupported"), InvalidArgumentError),
        (IndexingEstimateProviderUnavailableError(), ProviderNotInitializeError),
        (IndexingEstimateExecutionError(), IndexingEstimateError),
    ],
)
def test_new_source_estimate_maps_application_errors(
    error: Exception,
    expected_http_error: type[Exception],
) -> None:
    estimates = MagicMock()
    estimates.estimate_new_sources.side_effect = error
    registry = SimpleNamespace(knowledge=SimpleNamespace(indexing_estimates=estimates))
    api = DatasetIndexingEstimateApi()
    method = unwrap(api.post)
    payload = IndexingEstimatePayload(
        info_list={"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file-1"]}},
        process_rule={"mode": "automatic"},
        indexing_technique="economy",
    )
    context = RequestContext("request-1", None, "account-1", "workspace-1")

    with patch("controllers.console.datasets.datasets.application_services", return_value=registry):
        with pytest.raises(expected_http_error):
            method(api, payload, context)

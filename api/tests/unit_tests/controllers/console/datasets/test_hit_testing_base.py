from unittest.mock import patch

import pytest
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from controllers.console.datasets.hit_testing_base import (
    DatasetsHitTestingBase,
)
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from graphon.model_runtime.errors.invoke import InvokeError
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import Dataset
from services.dataset_service import DatasetService
from services.hit_testing_service import HitTestingService


@pytest.fixture
def account():
    acc = Account(name="User", email="user@example.com")
    acc.id = "account-1"
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    acc._current_tenant = tenant
    acc.role = TenantAccountRole.OWNER
    return acc


@pytest.fixture
def dataset():
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="Dataset", created_by="account-1")


def hit_testing_record() -> dict[str, object]:
    return {
        "segment": {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "Chunk text",
            "answer": None,
            "word_count": 2,
            "tokens": 3,
            "keywords": None,
            "index_node_id": None,
            "index_node_hash": None,
            "hit_count": 0,
            "enabled": True,
            "disabled_at": None,
            "disabled_by": None,
            "status": "completed",
            "created_by": "account-1",
            "created_at": 1_700_000_000,
            "indexing_at": None,
            "completed_at": None,
            "error": None,
            "stopped_at": None,
            "document": {
                "id": "document-1",
                "data_source_type": "upload_file",
                "name": "guide.md",
                "doc_type": None,
                "doc_metadata": None,
            },
        },
        "child_chunks": None,
        "files": None,
        "score": 0.8,
    }


class TestGetAndValidateDataset:
    def test_success(self, dataset, account):
        with (
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
        ):
            result = DatasetsHitTestingBase.get_and_validate_dataset("dataset-1", account, "tenant-1")

        assert result == dataset

    def test_dataset_not_found(self, account):
        with patch.object(
            DatasetService,
            "get_dataset",
            return_value=None,
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                DatasetsHitTestingBase.get_and_validate_dataset("dataset-1", account, "tenant-1")

    def test_permission_denied(self, dataset, account):
        with (
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden, match="no access"):
                DatasetsHitTestingBase.get_and_validate_dataset("dataset-1", account, "tenant-1")


class TestHitTestingArgsCheck:
    def test_args_check_called(self):
        args = {"query": "test"}

        with patch.object(
            HitTestingService,
            "hit_testing_args_check",
        ) as check_mock:
            DatasetsHitTestingBase.hit_testing_args_check(args)

        check_mock.assert_called_once_with(args)


class TestParseArgs:
    def test_parse_args_success(self):
        payload = {"query": "hello"}

        result = DatasetsHitTestingBase.parse_args(payload)

        assert result["query"] == "hello"

    def test_parse_args_invalid(self):
        payload = {"query": "x" * 300}

        with pytest.raises(ValueError):
            DatasetsHitTestingBase.parse_args(payload)

    def test_parse_args_ignores_unknown_fields_for_compatibility(self):
        payload = {"query": "hello", "top_k": 3}

        result = DatasetsHitTestingBase.parse_args(payload)

        assert result == {"query": "hello"}


class TestPerformHitTesting:
    def test_success(self, dataset, account):
        response = {
            "query": {"content": "hello"},
            "records": [],
        }

        with patch.object(
            HitTestingService,
            "retrieve",
            return_value=response,
        ):
            result = DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

        assert result["query"] == {"content": "hello"}
        assert result["records"] == []

    def test_success_prepares_nullable_list_fields(self, dataset, account):
        response = {
            "query": {"content": "hello"},
            "records": [hit_testing_record()],
        }

        with patch.object(
            HitTestingService,
            "retrieve",
            return_value=response,
        ):
            result = DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

        assert result["query"] == {"content": "hello"}
        record = result["records"][0]
        assert record["segment"]["keywords"] == []
        assert record["segment"]["sign_content"] is None
        assert record["child_chunks"] == []
        assert record["files"] == []
        assert record["score"] == 0.8
        assert record["tsne_position"] is None
        assert record["summary"] is None

    def test_invalid_query_response_raises_value_error(self, dataset, account):
        with (
            patch.object(
                HitTestingService,
                "retrieve",
                return_value={"query": "hello", "records": []},
            ),
            pytest.raises(ValueError, match="Invalid hit testing query response"),
        ):
            DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_invalid_records_response_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid hit testing records response"):
            DatasetsHitTestingBase._prepare_hit_testing_records({"records": []})

    def test_invalid_record_response_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid hit testing record response"):
            DatasetsHitTestingBase._prepare_hit_testing_records(["record"])

    def test_index_not_initialized(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=services.errors.index.IndexNotInitializedError(),
        ):
            with pytest.raises(DatasetNotInitializedError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_provider_token_not_init(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ProviderTokenNotInitError("token missing"),
        ):
            with pytest.raises(ProviderNotInitializeError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_quota_exceeded(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=QuotaExceededError(),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_model_not_supported(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ModelCurrentlyNotSupportError(),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_llm_bad_request(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=LLMBadRequestError("bad request"),
        ):
            with pytest.raises(ProviderNotInitializeError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_invoke_error(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=InvokeError("invoke failed"),
        ):
            with pytest.raises(CompletionRequestError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_value_error(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ValueError("bad args"),
        ):
            with pytest.raises(ValueError, match="bad args"):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

    def test_unexpected_error(self, dataset, account):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=Exception("boom"),
        ):
            with pytest.raises(InternalServerError, match="boom"):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"}, account, "tenant-1")

from unittest.mock import MagicMock, patch

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
from core.model_runtime.errors.invoke import InvokeError
from models.account import Account
from services.dataset_service import DatasetService
from services.hit_testing_service import HitTestingService


@pytest.fixture
def account():
    acc = MagicMock(spec=Account)
    return acc


@pytest.fixture(autouse=True)
def patch_current_user(mocker, account):
    """Patch current_user to a valid Account."""
    mocker.patch(
        "controllers.console.datasets.hit_testing_base.current_user",
        account,
    )


@pytest.fixture
def dataset():
    return MagicMock(id="dataset-1")


class TestGetAndValidateDataset:
    def test_success(self, dataset):
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
            result = DatasetsHitTestingBase.get_and_validate_dataset("dataset-1")

        assert result == dataset

    def test_dataset_not_found(self):
        with patch.object(
            DatasetService,
            "get_dataset",
            return_value=None,
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                DatasetsHitTestingBase.get_and_validate_dataset("dataset-1")

    def test_permission_denied(self, dataset):
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
                DatasetsHitTestingBase.get_and_validate_dataset("dataset-1")


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


class TestPerformHitTesting:
    def test_success(self, dataset):
        response = {
            "query": "hello",
            "records": [],
        }

        with patch.object(
            HitTestingService,
            "retrieve",
            return_value=response,
        ):
            result = DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

        assert result["query"] == "hello"
        assert result["records"] == []

    def test_index_not_initialized(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=services.errors.index.IndexNotInitializedError(),
        ):
            with pytest.raises(DatasetNotInitializedError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_provider_token_not_init(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ProviderTokenNotInitError("token missing"),
        ):
            with pytest.raises(ProviderNotInitializeError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_quota_exceeded(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=QuotaExceededError(),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_model_not_supported(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ModelCurrentlyNotSupportError(),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_llm_bad_request(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=LLMBadRequestError("bad request"),
        ):
            with pytest.raises(ProviderNotInitializeError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_invoke_error(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=InvokeError("invoke failed"),
        ):
            with pytest.raises(CompletionRequestError):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_value_error(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=ValueError("bad args"),
        ):
            with pytest.raises(ValueError, match="bad args"):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

    def test_unexpected_error(self, dataset):
        with patch.object(
            HitTestingService,
            "retrieve",
            side_effect=Exception("boom"),
        ):
            with pytest.raises(InternalServerError, match="boom"):
                DatasetsHitTestingBase.perform_hit_testing(dataset, {"query": "hello"})

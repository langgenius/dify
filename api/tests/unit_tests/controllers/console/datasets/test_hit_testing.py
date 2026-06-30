import uuid
from inspect import unwrap
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.datasets.hit_testing import HitTestingApi
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import Dataset


@pytest.fixture
def app():
    app = Flask("test_hit_testing")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def dataset_id():
    return uuid.uuid4()


@pytest.fixture
def dataset():
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="Dataset", created_by="account-1")


@pytest.fixture
def account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    tenant = Tenant(name="Tenant")
    tenant.id = "tenant-1"
    account._current_tenant = tenant
    account.role = TenantAccountRole.OWNER
    return account


def hit_testing_record() -> dict[str, object]:
    return {
        "segment": {
            "id": "segment-1",
            "position": 1,
            "document_id": "document-1",
            "content": "Chunk text",
            "sign_content": "Chunk text",
            "answer": None,
            "word_count": 2,
            "tokens": 3,
            "keywords": [],
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
        "child_chunks": [],
        "score": None,
        "tsne_position": None,
        "files": [],
        "summary": None,
    }


@pytest.fixture(autouse=True)
def bypass_decorators(mocker: MockerFixture):
    """Bypass all decorators on the API method."""
    mocker.patch(
        "controllers.console.datasets.hit_testing.setup_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.login_required",
        return_value=lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.account_initialization_required",
        return_value=lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.hit_testing.cloud_edition_billing_rate_limit_check",
        return_value=lambda *_: lambda f: f,
    )


class TestHitTestingApi:
    def test_hit_testing_success(self, app: Flask, dataset, dataset_id, account: Account):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "what is vector search",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
            ),
            patch.object(
                HitTestingApi,
                "perform_hit_testing",
                return_value={"query": {"content": "what is vector search"}, "records": []},
            ),
        ):
            result = method(api, account, "tenant-1", dataset_id)

        assert "query" in result
        assert "records" in result
        assert result["records"] == []

    def test_hit_testing_success_with_optional_record_fields(self, app: Flask, dataset, dataset_id, account: Account):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "what is vector search",
        }
        records = [hit_testing_record()]

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
            ),
            patch.object(
                HitTestingApi,
                "perform_hit_testing",
                return_value={"query": {"content": payload["query"]}, "records": records},
            ),
        ):
            result = method(api, account, "tenant-1", dataset_id)

        assert result["query"] == {"content": payload["query"]}
        assert result["records"][0]["segment"]["keywords"] == []
        assert result["records"][0]["child_chunks"] == []
        assert result["records"][0]["files"] == []
        assert result["records"][0]["score"] is None

    def test_hit_testing_success_with_null_document_name(self, app: Flask, dataset, dataset_id, account: Account):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "what is vector search",
        }
        records = [hit_testing_record()]
        records[0]["segment"]["document"]["name"] = None

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
            ),
            patch.object(
                HitTestingApi,
                "perform_hit_testing",
                return_value={"query": {"content": payload["query"]}, "records": records},
            ),
        ):
            result = method(api, account, "tenant-1", dataset_id)

        assert result["records"][0]["segment"]["document"]["name"] is None

    def test_hit_testing_dataset_not_found(self, app: Flask, dataset_id, account: Account):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "test",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                side_effect=NotFound("Dataset not found"),
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, account, "tenant-1", dataset_id)

    def test_hit_testing_invalid_args(self, app: Flask, dataset, dataset_id, account: Account):
        api = HitTestingApi()
        method = unwrap(api.post)

        payload = {
            "query": "",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch.object(
                HitTestingApi,
                "get_and_validate_dataset",
                return_value=dataset,
            ),
            patch.object(
                HitTestingApi,
                "hit_testing_args_check",
                side_effect=ValueError("Invalid parameters"),
            ),
        ):
            with pytest.raises(ValueError, match="Invalid parameters"):
                method(api, account, "tenant-1", dataset_id)

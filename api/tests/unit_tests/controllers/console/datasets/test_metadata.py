import uuid
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.console import console_ns
from controllers.console.datasets.metadata import (
    DatasetMetadataApi,
    DatasetMetadataBuiltInFieldActionApi,
    DatasetMetadataBuiltInFieldApi,
    DatasetMetadataCreateApi,
    DocumentMetadataEditApi,
)
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


def unwrap(func):
    """Recursively unwrap decorated functions."""
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_dataset_metadata")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def current_user():
    user = MagicMock()
    user.id = "user-1"
    return user


@pytest.fixture
def dataset():
    ds = MagicMock()
    ds.id = "dataset-1"
    return ds


@pytest.fixture
def dataset_id():
    return uuid.uuid4()


@pytest.fixture
def metadata_id():
    return uuid.uuid4()


@pytest.fixture(autouse=True)
def bypass_decorators(mocker):
    """Bypass setup/login/license decorators."""
    mocker.patch(
        "controllers.console.datasets.metadata.setup_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.metadata.login_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.metadata.account_initialization_required",
        lambda f: f,
    )
    mocker.patch(
        "controllers.console.datasets.metadata.enterprise_license_required",
        lambda f: f,
    )


class TestDatasetMetadataCreateApi:
    def test_create_metadata_success(self, app, current_user, dataset, dataset_id):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.post)

        payload = {"name": "author"}

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                MetadataArgs,
                "model_validate",
                return_value=MagicMock(),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
            patch.object(
                MetadataService,
                "create_metadata",
                return_value={"id": "m1", "name": "author"},
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 201
        assert result["name"] == "author"

    def test_create_metadata_dataset_not_found(self, app, current_user, dataset_id):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.post)

        valid_payload = {
            "type": "string",
            "name": "author",
        }

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=valid_payload,
            ),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                MetadataArgs,
                "model_validate",
                return_value=MagicMock(),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, dataset_id)


class TestDatasetMetadataGetApi:
    def test_get_metadata_success(self, app, dataset, dataset_id):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                MetadataService,
                "get_dataset_metadatas",
                return_value=[{"id": "m1"}],
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 200
        assert isinstance(result, list)

    def test_get_metadata_dataset_not_found(self, app, dataset_id):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, dataset_id)


class TestDatasetMetadataApi:
    def test_update_metadata_success(self, app, current_user, dataset, dataset_id, metadata_id):
        api = DatasetMetadataApi()
        method = unwrap(api.patch)

        payload = {"name": "updated-name"}

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
            patch.object(
                MetadataService,
                "update_metadata_name",
                return_value={"id": "m1", "name": "updated-name"},
            ),
        ):
            result, status = method(api, dataset_id, metadata_id)

        assert status == 200
        assert result["name"] == "updated-name"

    def test_delete_metadata_success(self, app, current_user, dataset, dataset_id, metadata_id):
        api = DatasetMetadataApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
            patch.object(
                MetadataService,
                "delete_metadata",
            ),
        ):
            result, status = method(api, dataset_id, metadata_id)

        assert status == 204
        assert result["result"] == "success"


class TestDatasetMetadataBuiltInFieldApi:
    def test_get_built_in_fields(self, app):
        api = DatasetMetadataBuiltInFieldApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                MetadataService,
                "get_built_in_fields",
                return_value=["title", "source"],
            ),
        ):
            result, status = method(api)

        assert status == 200
        assert result["fields"] == ["title", "source"]


class TestDatasetMetadataBuiltInFieldActionApi:
    def test_enable_built_in_field(self, app, current_user, dataset, dataset_id):
        api = DatasetMetadataBuiltInFieldActionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
            patch.object(
                MetadataService,
                "enable_built_in_field",
            ),
        ):
            result, status = method(api, dataset_id, "enable")

        assert status == 200
        assert result["result"] == "success"


class TestDocumentMetadataEditApi:
    def test_update_document_metadata_success(self, app, current_user, dataset, dataset_id):
        api = DocumentMetadataEditApi()
        method = unwrap(api.post)

        payload = {"operation": "add", "metadata": {}}

        with (
            app.test_request_context("/"),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.metadata.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
            ),
            patch.object(
                MetadataOperationData,
                "model_validate",
                return_value=MagicMock(),
            ),
            patch.object(
                MetadataService,
                "update_documents_metadata",
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 200
        assert result["result"] == "success"

import uuid
from inspect import unwrap
from unittest.mock import PropertyMock, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.controller_schemas import MetadataUpdatePayload
from controllers.console import console_ns
from controllers.console.datasets.metadata import (
    DatasetMetadataApi,
    DatasetMetadataBuiltInFieldActionApi,
    DatasetMetadataBuiltInFieldApi,
    DatasetMetadataCreateApi,
    DocumentMetadataEditApi,
)
from models.account import Account
from models.dataset import Dataset
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import MetadataArgs, MetadataOperationData
from services.errors.account import NoPermissionError
from services.errors.metadata import MetadataResourceNotFoundError
from services.metadata_service import MetadataService


@pytest.fixture
def app():
    app = Flask("test_dataset_metadata")

    app.config["TESTING"] = True
    return app


@pytest.fixture
def current_user() -> Account:
    user = Account(name="Test User", email="test@example.com")
    user.id = "user-1"
    return user


@pytest.fixture
def dataset() -> Dataset:
    return Dataset(id="dataset-1", tenant_id="tenant-1", name="Test Dataset", created_by="user-1")


@pytest.fixture
def dataset_id():
    return uuid.uuid4()


@pytest.fixture
def metadata_id():
    return uuid.uuid4()


@pytest.fixture(autouse=True)
def bypass_decorators(mocker: MockerFixture):
    """Bypass setup/login/license decorators."""
    mocker.patch("controllers.console.datasets.metadata.setup_required", lambda f: f)
    mocker.patch("controllers.console.datasets.metadata.login_required", lambda f: f)
    mocker.patch("controllers.console.datasets.metadata.account_initialization_required", lambda f: f)
    mocker.patch("controllers.console.datasets.metadata.enterprise_license_required", lambda f: f)


class TestDatasetMetadataCreateApi:
    def test_create_metadata_success(self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.post)
        payload = {"name": "author"}
        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(
                MetadataArgs,
                "model_validate",
                return_value=MetadataArgs(type="string", name="author"),
            ),
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                MetadataService, "create_metadata", return_value={"id": "m1", "type": "string", "name": "author"}
            ),
        ):
            result, status = method(
                api, MetadataArgs(type="string", name="author"), sqlite_session, "tenant-1", current_user, dataset_id
            )
        assert status == 201
        assert result["type"] == "string"
        assert result["name"] == "author"

    def test_create_metadata_dataset_not_found(self, app: Flask, current_user, dataset_id, sqlite_session: Session):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.post)
        valid_payload = {"type": "string", "name": "author"}
        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=valid_payload),
            patch.object(
                MetadataArgs,
                "model_validate",
                return_value=MetadataArgs(type="string", name="author"),
            ),
            patch.object(DatasetService, "get_dataset", return_value=None),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(
                    api,
                    MetadataArgs(type="string", name="author"),
                    sqlite_session,
                    "tenant-1",
                    current_user,
                    dataset_id,
                )


class TestDatasetMetadataGetApi:
    def test_get_metadata_success(self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset) as get_dataset,
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(
                MetadataService,
                "get_dataset_metadatas",
                return_value={
                    "doc_metadata": [{"id": "m1", "name": "author", "type": "string", "count": 0}],
                    "built_in_field_enabled": False,
                },
            ),
        ):
            result, status = method(api, sqlite_session, "tenant-1", current_user, dataset_id)
        assert status == 200
        assert result["doc_metadata"] == [{"id": "m1", "name": "author", "type": "string", "count": 0}]
        assert result["built_in_field_enabled"] is False
        get_dataset.assert_called_once_with(str(dataset_id), "tenant-1", session=sqlite_session)
        check_permission.assert_called_once_with(dataset, current_user, sqlite_session)

    def test_get_metadata_rejects_foreign_tenant_before_read(
        self, app: Flask, current_user, dataset_id, sqlite_session: Session
    ):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=None) as get_dataset,
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(MetadataService, "get_dataset_metadatas") as get_metadata,
        ):
            with pytest.raises(NotFound):
                method(api, sqlite_session, "tenant-1", current_user, dataset_id)

        get_dataset.assert_called_once_with(str(dataset_id), "tenant-1", session=sqlite_session)
        check_permission.assert_not_called()
        get_metadata.assert_not_called()

    def test_get_metadata_relies_on_rbac_in_rbac_mode(
        self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session
    ):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch("controllers.console.datasets.metadata.dify_config.RBAC_ENABLED", True),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(
                MetadataService,
                "get_dataset_metadatas",
                return_value={"doc_metadata": [], "built_in_field_enabled": False},
            ),
        ):
            _, status = method(api, sqlite_session, "tenant-1", current_user, dataset_id)

        assert status == 200
        check_permission.assert_not_called()

    def test_get_metadata_rejects_inaccessible_dataset(
        self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session
    ):
        api = DatasetMetadataCreateApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission", side_effect=NoPermissionError),
            patch.object(MetadataService, "get_dataset_metadatas") as get_metadata,
        ):
            with pytest.raises(Forbidden):
                method(api, sqlite_session, "tenant-1", current_user, dataset_id)

        get_metadata.assert_not_called()


class TestDatasetMetadataApi:
    def test_update_metadata_success(
        self, app: Flask, current_user, dataset, dataset_id, metadata_id, sqlite_session: Session
    ):
        api = DatasetMetadataApi()
        method = unwrap(api.patch)
        payload = {"name": "updated-name"}
        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset) as get_dataset,
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                MetadataService,
                "update_metadata_name",
                return_value={"id": "m1", "type": "string", "name": "updated-name"},
            ) as update_metadata,
        ):
            result, status = method(
                api,
                MetadataUpdatePayload(name="updated-name"),
                sqlite_session,
                "tenant-1",
                current_user,
                dataset_id,
                metadata_id,
            )
        assert status == 200
        assert result["type"] == "string"
        assert result["name"] == "updated-name"
        get_dataset.assert_called_once_with(str(dataset_id), "tenant-1", session=sqlite_session)
        update_metadata.assert_called_once_with(
            dataset, str(metadata_id), "updated-name", current_user, session=sqlite_session
        )

    def test_delete_metadata_success(
        self, app: Flask, current_user, dataset, dataset_id, metadata_id, sqlite_session: Session
    ):
        api = DatasetMetadataApi()
        method = unwrap(api.delete)
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset) as get_dataset,
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(MetadataService, "delete_metadata") as delete_metadata,
        ):
            result, status = method(api, sqlite_session, "tenant-1", current_user, dataset_id, metadata_id)
        assert status == 204
        assert result == ""
        get_dataset.assert_called_once_with(str(dataset_id), "tenant-1", session=sqlite_session)
        delete_metadata.assert_called_once_with(dataset, str(metadata_id), sqlite_session)


class TestDatasetMetadataBuiltInFieldApi:
    def test_get_built_in_fields(self, app: Flask):
        api = DatasetMetadataBuiltInFieldApi()
        method = unwrap(api.get)
        with (
            app.test_request_context("/"),
            patch.object(
                MetadataService,
                "get_built_in_fields",
                return_value=[{"name": "document_name", "type": "string"}, {"name": "source", "type": "string"}],
            ),
        ):
            result, status = method(api)
        assert status == 200
        assert result["fields"] == [{"name": "document_name", "type": "string"}, {"name": "source", "type": "string"}]


class TestDatasetMetadataBuiltInFieldActionApi:
    def test_enable_built_in_field(self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session):
        api = DatasetMetadataBuiltInFieldActionApi()
        method = unwrap(api.post)
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(MetadataService, "enable_built_in_field"),
        ):
            result, status = method(api, sqlite_session, current_user, dataset_id, "enable")
        assert status == 204
        assert result == ""


class TestDocumentMetadataEditApi:
    def test_update_document_metadata_success(
        self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session
    ):
        api = DocumentMetadataEditApi()
        method = unwrap(api.post)
        payload = {"operation": "add", "metadata": {}}
        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(MetadataService, "update_documents_metadata"),
        ):
            result, status = method(
                api,
                MetadataOperationData(
                    operation_data=[{"document_id": "00000000-0000-0000-0000-000000000001", "metadata_list": []}]
                ),
                sqlite_session,
                dataset.tenant_id,
                current_user,
                dataset_id,
            )
        assert status == 204
        assert result == ""

    def test_update_document_metadata_translates_missing_resource(
        self, app: Flask, current_user, dataset, dataset_id, sqlite_session: Session
    ):
        api = DocumentMetadataEditApi()
        method = unwrap(api.post)
        request = MetadataOperationData(operation_data=[])
        with (
            app.test_request_context("/"),
            patch.object(DatasetService, "get_dataset_for_tenant", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                MetadataService,
                "update_documents_metadata",
                side_effect=MetadataResourceNotFoundError("Metadata not found."),
            ),
            pytest.raises(NotFound) as exc_info,
        ):
            method(api, request, sqlite_session, dataset.tenant_id, current_user, dataset_id)

        assert exc_info.value.description == "Metadata not found."

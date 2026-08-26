"""
Unit tests for Service API Metadata controllers.

Tests coverage for:
- DatasetMetadataCreateServiceApi (post, get)
- DatasetMetadataServiceApi (patch, delete)
- DatasetMetadataBuiltInFieldServiceApi (get)
- DatasetMetadataBuiltInFieldActionServiceApi (post)
- DocumentMetadataEditServiceApi (post)

Decorator strategy:
- ``@cloud_edition_billing_rate_limit_check`` preserves ``__wrapped__``
  via ``functools.wraps`` → call the unwrapped method directly.
- Methods without billing decorators → call directly; only patch ``db``,
  services, and ``current_user``.
"""

import uuid
from inspect import unwrap
from unittest.mock import ANY, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.service_api.dataset import metadata as metadata_module
from controllers.service_api.dataset.metadata import (
    DatasetMetadataBuiltInFieldActionServiceApi,
    DatasetMetadataBuiltInFieldServiceApi,
    DatasetMetadataCreateServiceApi,
    DatasetMetadataServiceApi,
    DocumentMetadataEditServiceApi,
)
from models.account import Account, Tenant
from models.dataset import Dataset
from models.enums import PermissionEnum
from services.errors.metadata import MetadataResourceNotFoundError


@pytest.fixture
def mock_tenant() -> Tenant:
    tenant = Tenant(name="Metadata API Tenant")
    tenant.id = str(uuid.uuid4())
    return tenant


@pytest.fixture
def account() -> Account:
    account = Account(name="Metadata API User", email=f"metadata-api-{uuid.uuid4()}@example.com")
    account.id = str(uuid.uuid4())
    return account


@pytest.fixture
def mock_dataset(mock_tenant: Tenant, account: Account) -> Dataset:
    return Dataset(
        id=str(uuid.uuid4()),
        tenant_id=mock_tenant.id,
        name="Metadata Dataset",
        description="",
        provider="vendor",
        permission=PermissionEnum.ONLY_ME,
        indexing_technique="economy",
        created_by=account.id,
    )


@pytest.fixture(autouse=True)
def _use_current_user(monkeypatch: pytest.MonkeyPatch, account: Account) -> None:
    monkeypatch.setattr(metadata_module, "current_user", account)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# DatasetMetadataCreateServiceApi
# ---------------------------------------------------------------------------


class _UsesSQLiteSession:
    session: Session

    @pytest.fixture(autouse=True)
    def _inject_sqlite_session(self, sqlite_session: Session) -> None:
        self.session = sqlite_session


class TestDatasetMetadataCreatePost(_UsesSQLiteSession):
    """Tests for DatasetMetadataCreateServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``
    which preserves ``__wrapped__``.
    """

    @staticmethod
    def _call_post(api, session: Session, **kwargs):
        return unwrap(api.post)(api, session, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_create_metadata_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata creation."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_metadata = {"id": "meta-1", "type": "string", "name": "Author"}
        mock_meta_svc.create_metadata.return_value = mock_metadata

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata",
            method="POST",
            json={"type": "string", "name": "Author"},
        ):
            api = DatasetMetadataCreateServiceApi()
            session = self.session
            response, status = self._call_post(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 201
        assert response == {"id": "meta-1", "type": "string", "name": "Author"}
        mock_meta_svc.create_metadata.assert_called_once()

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_create_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata",
            method="POST",
            json={"type": "string", "name": "Author"},
        ):
            api = DatasetMetadataCreateServiceApi()
            session = self.session
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                )


class TestDatasetMetadataCreateGet(_UsesSQLiteSession):
    """Tests for DatasetMetadataCreateServiceApi.get()."""

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_get_metadata_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata list retrieval."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_meta_svc.get_dataset_metadatas.return_value = {
            "doc_metadata": [{"id": "m1", "name": "Author", "type": "string", "count": 0}],
            "built_in_field_enabled": False,
        }

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata",
            method="GET",
        ):
            api = DatasetMetadataCreateServiceApi()
            response, status = api.get(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 200
        assert response == {
            "doc_metadata": [{"id": "m1", "name": "Author", "type": "string", "count": 0}],
            "built_in_field_enabled": False,
        }

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_get_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata",
            method="GET",
        ):
            api = DatasetMetadataCreateServiceApi()
            with pytest.raises(NotFound):
                api.get(tenant_id=mock_tenant.id, dataset_id=mock_dataset.id)


# ---------------------------------------------------------------------------
# DatasetMetadataServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataServiceApiPatch(_UsesSQLiteSession):
    """Tests for DatasetMetadataServiceApi.patch().

    ``patch`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_patch(api, session: Session, **kwargs):
        return unwrap(api.patch)(api, session, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_metadata_name_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
        account: Account,
    ):
        """Test successful metadata name update."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset_for_tenant.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.update_metadata_name.return_value = {"id": metadata_id, "type": "string", "name": "New Name"}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="PATCH",
            json={"name": "New Name"},
        ):
            api = DatasetMetadataServiceApi()
            session = self.session
            response, status = self._call_patch(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                metadata_id=metadata_id,
            )

        assert status == 200
        assert response == {"id": metadata_id, "type": "string", "name": "New Name"}
        mock_dataset_svc.get_dataset_for_tenant.assert_called_once_with(
            str(mock_dataset.id), mock_tenant.id, session=session
        )
        mock_meta_svc.update_metadata_name.assert_called_once_with(
            mock_dataset, metadata_id, "New Name", account, session=session
        )

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset_for_tenant.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="PATCH",
            json={"name": "x"},
        ):
            api = DatasetMetadataServiceApi()
            session = self.session
            with pytest.raises(NotFound):
                self._call_patch(
                    api,
                    session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    metadata_id=metadata_id,
                )


class TestDatasetMetadataServiceApiDelete(_UsesSQLiteSession):
    """Tests for DatasetMetadataServiceApi.delete().

    ``delete`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_delete(api, session: Session, **kwargs):
        return unwrap(api.delete)(api, session, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_delete_metadata_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata deletion."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset_for_tenant.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.delete_metadata.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="DELETE",
        ):
            api = DatasetMetadataServiceApi()
            session = self.session
            response = self._call_delete(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                metadata_id=metadata_id,
            )

        assert response == ("", 204)
        mock_dataset_svc.get_dataset_for_tenant.assert_called_once_with(
            str(mock_dataset.id), mock_tenant.id, session=session
        )
        mock_meta_svc.delete_metadata.assert_called_once_with(mock_dataset, metadata_id, session)

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_delete_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset_for_tenant.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="DELETE",
        ):
            api = DatasetMetadataServiceApi()
            session = self.session
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    metadata_id=metadata_id,
                )


# ---------------------------------------------------------------------------
# DatasetMetadataBuiltInFieldServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataBuiltInFieldGet(_UsesSQLiteSession):
    """Tests for DatasetMetadataBuiltInFieldServiceApi.get()."""

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    def test_get_built_in_fields_success(
        self,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful built-in fields retrieval."""
        mock_meta_svc.get_built_in_fields.return_value = [
            {"name": "source", "type": "string"},
        ]

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/built-in",
            method="GET",
        ):
            api = DatasetMetadataBuiltInFieldServiceApi()
            response, status = api.get(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 200
        assert response == {"fields": [{"name": "source", "type": "string"}]}


# ---------------------------------------------------------------------------
# DatasetMetadataBuiltInFieldActionServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataBuiltInFieldAction(_UsesSQLiteSession):
    """Tests for DatasetMetadataBuiltInFieldActionServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_post(api, session: Session, **kwargs):
        return unwrap(api.post)(api, session, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_enable_built_in_field(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test enabling built-in metadata field."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/built-in/enable",
            method="POST",
        ):
            api = DatasetMetadataBuiltInFieldActionServiceApi()
            session = self.session
            response, status = self._call_post(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                action="enable",
            )

        assert status == 200
        assert response["result"] == "success"
        mock_meta_svc.enable_built_in_field.assert_called_once_with(mock_dataset, session)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_disable_built_in_field(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test disabling built-in metadata field."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/built-in/disable",
            method="POST",
        ):
            api = DatasetMetadataBuiltInFieldActionServiceApi()
            session = self.session
            response, status = self._call_post(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                action="disable",
            )

        assert status == 200
        mock_meta_svc.disable_built_in_field.assert_called_once_with(mock_dataset, session)

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_action_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/built-in/enable",
            method="POST",
        ):
            api = DatasetMetadataBuiltInFieldActionServiceApi()
            session = self.session
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )


# ---------------------------------------------------------------------------
# DocumentMetadataEditServiceApi
# ---------------------------------------------------------------------------


class TestDocumentMetadataEditPost(_UsesSQLiteSession):
    """Tests for DocumentMetadataEditServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_post(api, session: Session, **kwargs):
        return unwrap(api.post)(api, session, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_documents_metadata_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
        account: Account,
    ):
        """Test successful documents metadata update."""
        mock_dataset_svc.get_dataset_for_tenant.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.update_documents_metadata.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/metadata",
            method="POST",
            json={"operation_data": []},
        ):
            api = DocumentMetadataEditServiceApi()
            session = self.session
            response, status = self._call_post(
                api,
                session,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 200
        assert response["result"] == "success"
        mock_meta_svc.update_documents_metadata.assert_called_once_with(
            mock_dataset,
            ANY,
            account,
            session=session,
        )

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_documents_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_dataset_svc.get_dataset_for_tenant.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/metadata",
            method="POST",
            json={"operation_data": []},
        ):
            api = DocumentMetadataEditServiceApi()
            session = self.session
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                )

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_documents_metadata_translates_missing_resource(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        mock_dataset_svc.get_dataset_for_tenant.return_value = mock_dataset
        mock_meta_svc.update_documents_metadata.side_effect = MetadataResourceNotFoundError("Document not found.")

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/metadata",
            method="POST",
            json={"operation_data": []},
        ):
            api = DocumentMetadataEditServiceApi()
            with pytest.raises(NotFound) as exc_info:
                self._call_post(
                    api,
                    self.session,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                )

        assert exc_info.value.description == "Document not found."

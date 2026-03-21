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
from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import NotFound

from controllers.service_api.dataset.metadata import (
    DatasetMetadataBuiltInFieldActionServiceApi,
    DatasetMetadataBuiltInFieldServiceApi,
    DatasetMetadataCreateServiceApi,
    DatasetMetadataServiceApi,
    DocumentMetadataEditServiceApi,
)
from tests.unit_tests.controllers.service_api.conftest import _unwrap


@pytest.fixture
def mock_tenant():
    tenant = Mock()
    tenant.id = str(uuid.uuid4())
    return tenant


@pytest.fixture
def mock_dataset():
    dataset = Mock()
    dataset.id = str(uuid.uuid4())
    return dataset


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# DatasetMetadataCreateServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataCreatePost:
    """Tests for DatasetMetadataCreateServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``
    which preserves ``__wrapped__``.
    """

    @staticmethod
    def _call_post(api, **kwargs):
        return _unwrap(api.post)(api, **kwargs)

    @patch("controllers.service_api.dataset.metadata.marshal")
    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_create_metadata_success(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata creation."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_metadata = Mock()
        mock_meta_svc.create_metadata.return_value = mock_metadata
        mock_marshal.return_value = {"id": "meta-1", "name": "Author"}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata",
            method="POST",
            json={"type": "string", "name": "Author"},
        ):
            api = DatasetMetadataCreateServiceApi()
            response, status = self._call_post(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 201
        mock_meta_svc.create_metadata.assert_called_once()

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_create_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
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
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                )


class TestDatasetMetadataCreateGet:
    """Tests for DatasetMetadataCreateServiceApi.get()."""

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_get_metadata_success(
        self,
        mock_dataset_svc,
        mock_meta_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata list retrieval."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_meta_svc.get_dataset_metadatas.return_value = [{"id": "m1"}]

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

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_get_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
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


class TestDatasetMetadataServiceApiPatch:
    """Tests for DatasetMetadataServiceApi.patch().

    ``patch`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_patch(api, **kwargs):
        return _unwrap(api.patch)(api, **kwargs)

    @patch("controllers.service_api.dataset.metadata.marshal")
    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_update_metadata_name_success(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        mock_marshal,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata name update."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.update_metadata_name.return_value = Mock()
        mock_marshal.return_value = {"id": metadata_id, "name": "New Name"}

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="PATCH",
            json={"name": "New Name"},
        ):
            api = DatasetMetadataServiceApi()
            response, status = self._call_patch(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                metadata_id=metadata_id,
            )

        assert status == 200
        mock_meta_svc.update_metadata_name.assert_called_once()

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="PATCH",
            json={"name": "x"},
        ):
            api = DatasetMetadataServiceApi()
            with pytest.raises(NotFound):
                self._call_patch(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    metadata_id=metadata_id,
                )


class TestDatasetMetadataServiceApiDelete:
    """Tests for DatasetMetadataServiceApi.delete().

    ``delete`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_delete(api, **kwargs):
        return _unwrap(api.delete)(api, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_delete_metadata_success(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful metadata deletion."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.delete_metadata.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="DELETE",
        ):
            api = DatasetMetadataServiceApi()
            response = self._call_delete(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                metadata_id=metadata_id,
            )

        assert response == ("", 204)
        mock_meta_svc.delete_metadata.assert_called_once()

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_delete_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        metadata_id = str(uuid.uuid4())
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/metadata/{metadata_id}",
            method="DELETE",
        ):
            api = DatasetMetadataServiceApi()
            with pytest.raises(NotFound):
                self._call_delete(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    metadata_id=metadata_id,
                )


# ---------------------------------------------------------------------------
# DatasetMetadataBuiltInFieldServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataBuiltInFieldGet:
    """Tests for DatasetMetadataBuiltInFieldServiceApi.get()."""

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    def test_get_built_in_fields_success(
        self,
        mock_meta_svc,
        app,
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
        assert "fields" in response


# ---------------------------------------------------------------------------
# DatasetMetadataBuiltInFieldActionServiceApi
# ---------------------------------------------------------------------------


class TestDatasetMetadataBuiltInFieldAction:
    """Tests for DatasetMetadataBuiltInFieldActionServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_post(api, **kwargs):
        return _unwrap(api.post)(api, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_enable_built_in_field(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        app,
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
            response, status = self._call_post(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                action="enable",
            )

        assert status == 200
        assert response["result"] == "success"
        mock_meta_svc.enable_built_in_field.assert_called_once_with(mock_dataset)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_disable_built_in_field(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        app,
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
            response, status = self._call_post(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                action="disable",
            )

        assert status == 200
        mock_meta_svc.disable_built_in_field.assert_called_once_with(mock_dataset)

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_action_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
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
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )


# ---------------------------------------------------------------------------
# DocumentMetadataEditServiceApi
# ---------------------------------------------------------------------------


class TestDocumentMetadataEditPost:
    """Tests for DocumentMetadataEditServiceApi.post().

    ``post`` is wrapped by ``@cloud_edition_billing_rate_limit_check``.
    """

    @staticmethod
    def _call_post(api, **kwargs):
        return _unwrap(api.post)(api, **kwargs)

    @patch("controllers.service_api.dataset.metadata.MetadataService")
    @patch("controllers.service_api.dataset.metadata.DatasetService")
    @patch("controllers.service_api.dataset.metadata.current_user")
    def test_update_documents_metadata_success(
        self,
        mock_current_user,
        mock_dataset_svc,
        mock_meta_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test successful documents metadata update."""
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_meta_svc.update_documents_metadata.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/metadata",
            method="POST",
            json={"operation_data": []},
        ):
            api = DocumentMetadataEditServiceApi()
            response, status = self._call_post(
                api,
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
            )

        assert status == 200
        assert response["result"] == "success"

    @patch("controllers.service_api.dataset.metadata.DatasetService")
    def test_update_documents_metadata_dataset_not_found(
        self,
        mock_dataset_svc,
        app,
        mock_tenant,
        mock_dataset,
    ):
        """Test 404 when dataset not found."""
        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/metadata",
            method="POST",
            json={"operation_data": []},
        ):
            api = DocumentMetadataEditServiceApi()
            with pytest.raises(NotFound):
                self._call_post(
                    api,
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                )

"""
Extensive unit tests for ``ExternalDatasetService``.

This module focuses on the *external dataset service* surface area, which is responsible
for integrating with **external knowledge APIs** and wiring them into Dify datasets.

The goal of this test suite is twofold:

- Provide **high‑confidence regression coverage** for all public helpers on
  ``ExternalDatasetService``.
- Serve as **executable documentation** for how external API integration is expected
  to behave in different scenarios (happy paths, validation failures, and error codes).

The file intentionally contains **rich comments and generous spacing** in order to make
each scenario easy to scan during reviews.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, Mock, patch

import httpx
import pytest

from constants import HIDDEN_VALUE
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import (
    Authorization,
    AuthorizationConfig,
    ExternalKnowledgeApiSetting,
)
from services.errors.dataset import DatasetNameDuplicateError
from services.external_knowledge_service import ExternalDatasetService


class ExternalDatasetTestDataFactory:
    """
    Factory helpers for building *lightweight* mocks for external knowledge tests.

    These helpers are intentionally small and explicit:

    - They avoid pulling in unnecessary fixtures.
    - They reflect the minimal contract that the service under test cares about.
    """

    @staticmethod
    def create_external_api(
        api_id: str = "api-123",
        tenant_id: str = "tenant-1",
        name: str = "Test API",
        description: str = "Description",
        settings: dict | None = None,
    ) -> ExternalKnowledgeApis:
        """
        Create a concrete ``ExternalKnowledgeApis`` instance with minimal fields.

        Using the real SQLAlchemy model (instead of a pure Mock) makes it easier to
        exercise ``settings_dict`` and other convenience properties if needed.
        """

        instance = ExternalKnowledgeApis(
            tenant_id=tenant_id,
            name=name,
            description=description,
            settings=None if settings is None else cast(str, pytest.approx),  # type: ignore[assignment]
        )

        # Overwrite generated id for determinism in assertions.
        instance.id = api_id
        return instance

    @staticmethod
    def create_dataset(
        dataset_id: str = "ds-1",
        tenant_id: str = "tenant-1",
        name: str = "External Dataset",
        provider: str = "external",
    ) -> Dataset:
        """
        Build a small ``Dataset`` instance representing an external dataset.
        """

        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            description="",
            provider=provider,
            created_by="user-1",
        )
        dataset.id = dataset_id
        return dataset

    @staticmethod
    def create_external_binding(
        tenant_id: str = "tenant-1",
        dataset_id: str = "ds-1",
        api_id: str = "api-1",
        external_knowledge_id: str = "knowledge-1",
    ) -> ExternalKnowledgeBindings:
        """
        Small helper for a binding between dataset and external knowledge API.
        """

        binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            external_knowledge_api_id=api_id,
            external_knowledge_id=external_knowledge_id,
            created_by="user-1",
        )
        return binding


# ---------------------------------------------------------------------------
# get_external_knowledge_apis
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceGetExternalKnowledgeApis:
    """
    Tests for ``ExternalDatasetService.get_external_knowledge_apis``.

    These tests focus on:

    - Basic pagination wiring via ``db.paginate``.
    - Optional search keyword behaviour.
    """

    @pytest.fixture
    def mock_db_paginate(self):
        """
        Patch ``db.paginate`` so we do not touch the real database layer.
        """

        with (
            patch("services.external_knowledge_service.db.paginate") as mock_paginate,
            patch("services.external_knowledge_service.select"),
        ):
            yield mock_paginate

    def test_get_external_knowledge_apis_basic_pagination(self, mock_db_paginate: MagicMock):
        """
        It should return ``items`` and ``total`` coming from the paginate object.
        """

        # Arrange
        tenant_id = "tenant-1"
        page = 1
        per_page = 20

        mock_items = [Mock(spec=ExternalKnowledgeApis), Mock(spec=ExternalKnowledgeApis)]
        mock_pagination = SimpleNamespace(items=mock_items, total=42)
        mock_db_paginate.return_value = mock_pagination

        # Act
        items, total = ExternalDatasetService.get_external_knowledge_apis(page, per_page, tenant_id)

        # Assert
        assert items is mock_items
        assert total == 42

        mock_db_paginate.assert_called_once()
        call_kwargs = mock_db_paginate.call_args.kwargs
        assert call_kwargs["page"] == page
        assert call_kwargs["per_page"] == per_page
        assert call_kwargs["max_per_page"] == 100
        assert call_kwargs["error_out"] is False

    def test_get_external_knowledge_apis_with_search_keyword(self, mock_db_paginate: MagicMock):
        """
        When a search keyword is provided, the query should be adjusted
        (we simply assert that paginate is still called and does not explode).
        """

        # Arrange
        tenant_id = "tenant-1"
        page = 2
        per_page = 10
        search = "foo"

        mock_pagination = SimpleNamespace(items=[], total=0)
        mock_db_paginate.return_value = mock_pagination

        # Act
        items, total = ExternalDatasetService.get_external_knowledge_apis(page, per_page, tenant_id, search=search)

        # Assert
        assert items == []
        assert total == 0
        mock_db_paginate.assert_called_once()


# ---------------------------------------------------------------------------
# validate_api_list
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceValidateApiList:
    """
    Lightweight validation tests for ``validate_api_list``.
    """

    def test_validate_api_list_success(self):
        """
        A minimal valid configuration (endpoint + api_key) should pass.
        """

        config = {"endpoint": "https://example.com", "api_key": "secret"}

        # Act & Assert – no exception expected
        ExternalDatasetService.validate_api_list(config)

    @pytest.mark.parametrize(
        ("config", "expected_message"),
        [
            ({}, "api list is empty"),
            ({"api_key": "k"}, "endpoint is required"),
            ({"endpoint": "https://example.com"}, "api_key is required"),
        ],
    )
    def test_validate_api_list_failures(self, config: dict, expected_message: str):
        """
        Invalid configs should raise ``ValueError`` with a clear message.
        """

        with pytest.raises(ValueError, match=expected_message):
            ExternalDatasetService.validate_api_list(config)


# ---------------------------------------------------------------------------
# create_external_knowledge_api & get/update/delete
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceCrudExternalKnowledgeApi:
    """
    CRUD tests for external knowledge API templates.
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Patch ``db.session`` for all CRUD tests in this class.
        """

        with patch("services.external_knowledge_service.db.session") as mock_session:
            yield mock_session

    def test_create_external_knowledge_api_success(self, mock_db_session: MagicMock):
        """
        ``create_external_knowledge_api`` should persist a new record
        when settings are present and valid.
        """

        tenant_id = "tenant-1"
        user_id = "user-1"
        args = {
            "name": "API",
            "description": "desc",
            "settings": {"endpoint": "https://api.example.com", "api_key": "secret"},
        }

        # We do not want to actually call the remote endpoint here, so we patch the validator.
        with patch.object(ExternalDatasetService, "check_endpoint_and_api_key") as mock_check:
            result = ExternalDatasetService.create_external_knowledge_api(tenant_id, user_id, args)

        assert isinstance(result, ExternalKnowledgeApis)
        mock_check.assert_called_once_with(args["settings"])
        mock_db_session.add.assert_called_once()
        mock_db_session.commit.assert_called_once()

    def test_create_external_knowledge_api_missing_settings_raises(self, mock_db_session: MagicMock):
        """
        Missing ``settings`` should result in a ``ValueError``.
        """

        tenant_id = "tenant-1"
        user_id = "user-1"
        args = {"name": "API", "description": "desc"}

        with pytest.raises(ValueError, match="settings is required"):
            ExternalDatasetService.create_external_knowledge_api(tenant_id, user_id, args)

        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_get_external_knowledge_api_found(self, mock_db_session: MagicMock):
        """
        ``get_external_knowledge_api`` should return the first matching record.
        """

        api = Mock(spec=ExternalKnowledgeApis)
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = api

        result = ExternalDatasetService.get_external_knowledge_api("api-id")
        assert result is api

    def test_get_external_knowledge_api_not_found_raises(self, mock_db_session: MagicMock):
        """
        When the record is absent, a ``ValueError`` is raised.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.get_external_knowledge_api("missing-id")

    def test_update_external_knowledge_api_success_with_hidden_api_key(self, mock_db_session: MagicMock):
        """
        Updating an API should keep the existing API key when the special hidden
        value placeholder is sent from the UI.
        """

        tenant_id = "tenant-1"
        user_id = "user-1"
        api_id = "api-1"

        existing_api = Mock(spec=ExternalKnowledgeApis)
        existing_api.settings_dict = {"api_key": "stored-key"}
        existing_api.settings = '{"api_key":"stored-key"}'
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = existing_api

        args = {
            "name": "New Name",
            "description": "New Desc",
            "settings": {"endpoint": "https://api.example.com", "api_key": HIDDEN_VALUE},
        }

        result = ExternalDatasetService.update_external_knowledge_api(tenant_id, user_id, api_id, args)

        assert result is existing_api
        # The placeholder should be replaced with stored key.
        assert args["settings"]["api_key"] == "stored-key"
        mock_db_session.commit.assert_called_once()

    def test_update_external_knowledge_api_not_found_raises(self, mock_db_session: MagicMock):
        """
        Updating a non‑existent API template should raise ``ValueError``.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.update_external_knowledge_api(
                tenant_id="tenant-1",
                user_id="user-1",
                external_knowledge_api_id="missing-id",
                args={"name": "n", "description": "d", "settings": {}},
            )

    def test_delete_external_knowledge_api_success(self, mock_db_session: MagicMock):
        """
        ``delete_external_knowledge_api`` should delete and commit when found.
        """

        api = Mock(spec=ExternalKnowledgeApis)
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = api

        ExternalDatasetService.delete_external_knowledge_api("tenant-1", "api-1")

        mock_db_session.delete.assert_called_once_with(api)
        mock_db_session.commit.assert_called_once()

    def test_delete_external_knowledge_api_not_found_raises(self, mock_db_session: MagicMock):
        """
        Deletion of a missing template should raise ``ValueError``.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.delete_external_knowledge_api("tenant-1", "missing")


# ---------------------------------------------------------------------------
# external_knowledge_api_use_check & binding lookups
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceUsageAndBindings:
    """
    Tests for usage checks and dataset binding retrieval.
    """

    @pytest.fixture
    def mock_db_session(self):
        with patch("services.external_knowledge_service.db.session") as mock_session:
            yield mock_session

    def test_external_knowledge_api_use_check_in_use(self, mock_db_session: MagicMock):
        """
        When there are bindings, ``external_knowledge_api_use_check`` returns True and count.
        """

        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 3

        in_use, count = ExternalDatasetService.external_knowledge_api_use_check("api-1")

        assert in_use is True
        assert count == 3

    def test_external_knowledge_api_use_check_not_in_use(self, mock_db_session: MagicMock):
        """
        Zero bindings should return ``(False, 0)``.
        """

        mock_db_session.query.return_value.filter_by.return_value.count.return_value = 0

        in_use, count = ExternalDatasetService.external_knowledge_api_use_check("api-1")

        assert in_use is False
        assert count == 0

    def test_get_external_knowledge_binding_with_dataset_id_found(self, mock_db_session: MagicMock):
        """
        Binding lookup should return the first record when present.
        """

        binding = Mock(spec=ExternalKnowledgeBindings)
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = binding

        result = ExternalDatasetService.get_external_knowledge_binding_with_dataset_id("tenant-1", "ds-1")
        assert result is binding

    def test_get_external_knowledge_binding_with_dataset_id_not_found_raises(self, mock_db_session: MagicMock):
        """
        Missing binding should result in a ``ValueError``.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="external knowledge binding not found"):
            ExternalDatasetService.get_external_knowledge_binding_with_dataset_id("tenant-1", "ds-1")


# ---------------------------------------------------------------------------
# document_create_args_validate
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceDocumentCreateArgsValidate:
    """
    Tests for ``document_create_args_validate``.
    """

    @pytest.fixture
    def mock_db_session(self):
        with patch("services.external_knowledge_service.db.session") as mock_session:
            yield mock_session

    def test_document_create_args_validate_success(self, mock_db_session: MagicMock):
        """
        All required custom parameters present – validation should pass.
        """

        external_api = Mock(spec=ExternalKnowledgeApis)
        external_api.settings = json_settings = (
            '[{"document_process_setting":[{"name":"foo","required":true},{"name":"bar","required":false}]}]'
        )
        # Raw string; the service itself calls json.loads on it
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = external_api

        process_parameter = {"foo": "value", "bar": "optional"}

        # Act & Assert – no exception
        ExternalDatasetService.document_create_args_validate("tenant-1", "api-1", process_parameter)

        assert json_settings in external_api.settings  # simple sanity check on our test data

    def test_document_create_args_validate_missing_template_raises(self, mock_db_session: MagicMock):
        """
        When the referenced API template is missing, a ``ValueError`` is raised.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.document_create_args_validate("tenant-1", "missing", {})

    def test_document_create_args_validate_missing_required_parameter_raises(self, mock_db_session: MagicMock):
        """
        Required document process parameters must be supplied.
        """

        external_api = Mock(spec=ExternalKnowledgeApis)
        external_api.settings = (
            '[{"document_process_setting":[{"name":"foo","required":true},{"name":"bar","required":false}]}]'
        )
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = external_api

        process_parameter = {"bar": "present"}  # missing "foo"

        with pytest.raises(ValueError, match="foo is required"):
            ExternalDatasetService.document_create_args_validate("tenant-1", "api-1", process_parameter)


# ---------------------------------------------------------------------------
# process_external_api
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceProcessExternalApi:
    """
    Tests focused on the HTTP request assembly and method mapping behaviour.
    """

    def test_process_external_api_valid_method_post(self):
        """
        For a supported HTTP verb we should delegate to the correct ``ssrf_proxy`` function.
        """

        settings = ExternalKnowledgeApiSetting(
            url="https://example.com/path",
            request_method="POST",
            headers={"X-Test": "1"},
            params={"foo": "bar"},
        )

        fake_response = httpx.Response(200)

        with patch("services.external_knowledge_service.ssrf_proxy.post") as mock_post:
            mock_post.return_value = fake_response

            result = ExternalDatasetService.process_external_api(settings, files=None)

        assert result is fake_response
        mock_post.assert_called_once()
        kwargs = mock_post.call_args.kwargs
        assert kwargs["url"] == settings.url
        assert kwargs["headers"] == settings.headers
        assert kwargs["follow_redirects"] is True
        assert "data" in kwargs

    def test_process_external_api_invalid_method_raises(self):
        """
        An unsupported HTTP verb should raise ``InvalidHttpMethodError``.
        """

        settings = ExternalKnowledgeApiSetting(
            url="https://example.com",
            request_method="INVALID",
            headers=None,
            params={},
        )

        from core.workflow.nodes.http_request.exc import InvalidHttpMethodError

        with pytest.raises(InvalidHttpMethodError):
            ExternalDatasetService.process_external_api(settings, files=None)


# ---------------------------------------------------------------------------
# assembling_headers
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceAssemblingHeaders:
    """
    Tests for header assembly based on different authentication flavours.
    """

    def test_assembling_headers_bearer_token(self):
        """
        For bearer auth we expect ``Authorization: Bearer <key>`` by default.
        """

        auth = Authorization(
            type="api-key",
            config=AuthorizationConfig(type="bearer", api_key="secret", header=None),
        )

        headers = ExternalDatasetService.assembling_headers(auth)

        assert headers["Authorization"] == "Bearer secret"

    def test_assembling_headers_basic_token_with_custom_header(self):
        """
        For basic auth we honour the configured header name.
        """

        auth = Authorization(
            type="api-key",
            config=AuthorizationConfig(type="basic", api_key="abc123", header="X-Auth"),
        )

        headers = ExternalDatasetService.assembling_headers(auth, headers={"Existing": "1"})

        assert headers["Existing"] == "1"
        assert headers["X-Auth"] == "Basic abc123"

    def test_assembling_headers_custom_type(self):
        """
        Custom auth type should inject the raw API key.
        """

        auth = Authorization(
            type="api-key",
            config=AuthorizationConfig(type="custom", api_key="raw-key", header="X-API-KEY"),
        )

        headers = ExternalDatasetService.assembling_headers(auth, headers=None)

        assert headers["X-API-KEY"] == "raw-key"

    def test_assembling_headers_missing_config_raises(self):
        """
        Missing config object should be rejected.
        """

        auth = Authorization(type="api-key", config=None)

        with pytest.raises(ValueError, match="authorization config is required"):
            ExternalDatasetService.assembling_headers(auth)

    def test_assembling_headers_missing_api_key_raises(self):
        """
        ``api_key`` is required when type is ``api-key``.
        """

        auth = Authorization(
            type="api-key",
            config=AuthorizationConfig(type="bearer", api_key=None, header="Authorization"),
        )

        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.assembling_headers(auth)

    def test_assembling_headers_no_auth_type_leaves_headers_unchanged(self):
        """
        For ``no-auth`` we should not modify the headers mapping.
        """

        auth = Authorization(type="no-auth", config=None)

        base_headers = {"X": "1"}
        result = ExternalDatasetService.assembling_headers(auth, headers=base_headers)

        # A copy is returned, original is not mutated.
        assert result == base_headers
        assert result is not base_headers


# ---------------------------------------------------------------------------
# get_external_knowledge_api_settings
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceGetExternalKnowledgeApiSettings:
    """
    Simple shape test for ``get_external_knowledge_api_settings``.
    """

    def test_get_external_knowledge_api_settings(self):
        settings_dict: dict[str, Any] = {
            "url": "https://example.com/retrieval",
            "request_method": "post",
            "headers": {"Content-Type": "application/json"},
            "params": {"foo": "bar"},
        }

        result = ExternalDatasetService.get_external_knowledge_api_settings(settings_dict)

        assert isinstance(result, ExternalKnowledgeApiSetting)
        assert result.url == settings_dict["url"]
        assert result.request_method == settings_dict["request_method"]
        assert result.headers == settings_dict["headers"]
        assert result.params == settings_dict["params"]


# ---------------------------------------------------------------------------
# create_external_dataset
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceCreateExternalDataset:
    """
    Tests around creating the external dataset and its binding row.
    """

    @pytest.fixture
    def mock_db_session(self):
        with patch("services.external_knowledge_service.db.session") as mock_session:
            yield mock_session

    def test_create_external_dataset_success(self, mock_db_session: MagicMock):
        """
        A brand new dataset name with valid external knowledge references
        should create both the dataset and its binding.
        """

        tenant_id = "tenant-1"
        user_id = "user-1"

        args = {
            "name": "My Dataset",
            "description": "desc",
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "knowledge-1",
            "external_retrieval_model": {"top_k": 3},
        }

        # No existing dataset with same name.
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            None,  # duplicate‑name check
            Mock(spec=ExternalKnowledgeApis),  # external knowledge api
        ]

        dataset = ExternalDatasetService.create_external_dataset(tenant_id, user_id, args)

        assert isinstance(dataset, Dataset)
        assert dataset.provider == "external"
        assert dataset.retrieval_model == args["external_retrieval_model"]

        assert mock_db_session.add.call_count >= 2  # dataset + binding
        mock_db_session.flush.assert_called_once()
        mock_db_session.commit.assert_called_once()

    def test_create_external_dataset_duplicate_name_raises(self, mock_db_session: MagicMock):
        """
        When a dataset with the same name already exists,
        ``DatasetNameDuplicateError`` is raised.
        """

        existing_dataset = Mock(spec=Dataset)
        mock_db_session.query.return_value.filter_by.return_value.first.return_value = existing_dataset

        args = {
            "name": "Existing",
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "knowledge-1",
        }

        with pytest.raises(DatasetNameDuplicateError):
            ExternalDatasetService.create_external_dataset("tenant-1", "user-1", args)

        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_create_external_dataset_missing_api_template_raises(self, mock_db_session: MagicMock):
        """
        If the referenced external knowledge API does not exist, a ``ValueError`` is raised.
        """

        # First call: duplicate name check – not found.
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            None,
            None,  # external knowledge api lookup
        ]

        args = {
            "name": "Dataset",
            "external_knowledge_api_id": "missing",
            "external_knowledge_id": "knowledge-1",
        }

        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.create_external_dataset("tenant-1", "user-1", args)

    def test_create_external_dataset_missing_required_ids_raise(self, mock_db_session: MagicMock):
        """
        ``external_knowledge_id`` and ``external_knowledge_api_id`` are mandatory.
        """

        # duplicate name check
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            None,
            Mock(spec=ExternalKnowledgeApis),
        ]

        args_missing_knowledge_id = {
            "name": "Dataset",
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": None,
        }

        with pytest.raises(ValueError, match="external_knowledge_id is required"):
            ExternalDatasetService.create_external_dataset("tenant-1", "user-1", args_missing_knowledge_id)

        args_missing_api_id = {
            "name": "Dataset",
            "external_knowledge_api_id": None,
            "external_knowledge_id": "k-1",
        }

        with pytest.raises(ValueError, match="external_knowledge_api_id is required"):
            ExternalDatasetService.create_external_dataset("tenant-1", "user-1", args_missing_api_id)


# ---------------------------------------------------------------------------
# fetch_external_knowledge_retrieval
# ---------------------------------------------------------------------------


class TestExternalDatasetServiceFetchExternalKnowledgeRetrieval:
    """
    Tests for ``fetch_external_knowledge_retrieval`` which orchestrates
    external retrieval requests and normalises the response payload.
    """

    @pytest.fixture
    def mock_db_session(self):
        with patch("services.external_knowledge_service.db.session") as mock_session:
            yield mock_session

    def test_fetch_external_knowledge_retrieval_success(self, mock_db_session: MagicMock):
        """
        With a valid binding and API template, records from the external
        service should be returned when the HTTP response is 200.
        """

        tenant_id = "tenant-1"
        dataset_id = "ds-1"
        query = "test query"
        external_retrieval_parameters = {"top_k": 3, "score_threshold_enabled": True, "score_threshold": 0.5}

        binding = ExternalDatasetTestDataFactory.create_external_binding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            api_id="api-1",
            external_knowledge_id="knowledge-1",
        )

        api = Mock(spec=ExternalKnowledgeApis)
        api.settings = '{"endpoint":"https://example.com","api_key":"secret"}'

        # First query: binding; second query: api.
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            binding,
            api,
        ]

        fake_records = [{"content": "doc", "score": 0.9}]
        fake_response = Mock(spec=httpx.Response)
        fake_response.status_code = 200
        fake_response.json.return_value = {"records": fake_records}

        metadata_condition = SimpleNamespace(model_dump=lambda: {"field": "value"})

        with patch.object(ExternalDatasetService, "process_external_api", return_value=fake_response) as mock_process:
            result = ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                query=query,
                external_retrieval_parameters=external_retrieval_parameters,
                metadata_condition=metadata_condition,
            )

        assert result == fake_records

        mock_process.assert_called_once()
        setting_arg = mock_process.call_args.args[0]
        assert isinstance(setting_arg, ExternalKnowledgeApiSetting)
        assert setting_arg.url.endswith("/retrieval")

    def test_fetch_external_knowledge_retrieval_binding_not_found_raises(self, mock_db_session: MagicMock):
        """
        Missing binding should raise ``ValueError``.
        """

        mock_db_session.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(ValueError, match="external knowledge binding not found"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id="tenant-1",
                dataset_id="missing",
                query="q",
                external_retrieval_parameters={},
                metadata_condition=None,
            )

    def test_fetch_external_knowledge_retrieval_missing_api_template_raises(self, mock_db_session: MagicMock):
        """
        When the API template is missing or has no settings, a ``ValueError`` is raised.
        """

        binding = ExternalDatasetTestDataFactory.create_external_binding()
        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            binding,
            None,
        ]

        with pytest.raises(ValueError, match="external api template not found"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id="tenant-1",
                dataset_id="ds-1",
                query="q",
                external_retrieval_parameters={},
                metadata_condition=None,
            )

    def test_fetch_external_knowledge_retrieval_non_200_status_returns_empty_list(self, mock_db_session: MagicMock):
        """
        Non‑200 responses should be treated as an empty result set.
        """

        binding = ExternalDatasetTestDataFactory.create_external_binding()
        api = Mock(spec=ExternalKnowledgeApis)
        api.settings = '{"endpoint":"https://example.com","api_key":"secret"}'

        mock_db_session.query.return_value.filter_by.return_value.first.side_effect = [
            binding,
            api,
        ]

        fake_response = Mock(spec=httpx.Response)
        fake_response.status_code = 500
        fake_response.json.return_value = {}

        with patch.object(ExternalDatasetService, "process_external_api", return_value=fake_response):
            result = ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id="tenant-1",
                dataset_id="ds-1",
                query="q",
                external_retrieval_parameters={},
                metadata_condition=None,
            )

        assert result == []

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import Literal, NoReturn, cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from flask.testing import FlaskClient
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound, UnprocessableEntity

import services.errors.base
from configs import DifyConfig
from controllers.service_api.dataset.dataset import (
    DatasetCreatePayload,
    DatasetListQuery,
    DatasetUpdatePayload,
    TagBindingPayload,
    TagCreatePayload,
    TagDeletePayload,
    TagUnbindingPayload,
    TagUpdatePayload,
)
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import AppDatasetJoin, Dataset, DatasetMetadata, DatasetPermissionEnum, Document
from models.enums import PermissionEnum, TagType
from models.model import ApiToken, App, DatasetApiTokenBinding, Tag, TagBinding
from repositories.tag_repository import TagRepository

"""Unit tests for Service API dataset controller behavior.

Service boundaries stay mocked, while ORM collaborators are concrete model instances
persisted through the shared SQLite session fixture.
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
DATASET_MODEL_TABLES = (
    Account,
    Tenant,
    Dataset,
    Document,
    App,
    AppDatasetJoin,
    DatasetMetadata,
    Tag,
    TagBinding,
)


def make_dataset(
    session: Session,
    tenant: Tenant,
    account: Account,
    **overrides: object,
) -> Dataset:
    """Create and flush a real dataset so its database-backed properties can be serialized."""

    base: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant.id,
        "name": "Dataset",
        "description": "desc",
        "provider": "vendor",
        "permission": PermissionEnum.ONLY_ME,
        "data_source_type": None,
        "indexing_technique": "economy",
        "created_by": account.id,
        "created_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        "updated_by": None,
        "updated_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        "embedding_model": None,
        "embedding_model_provider": None,
        "retrieval_model": None,
        "summary_index_setting": None,
        "built_in_field_enabled": False,
        "pipeline_id": None,
        "runtime_mode": "general",
        "chunk_structure": None,
        "icon_info": None,
        "enable_api": False,
        "is_multimodal": False,
    }
    base.update(overrides)
    created_at = cast(datetime, base.pop("created_at"))
    updated_at = cast(datetime, base.pop("updated_at"))
    dataset = Dataset(**base)  # type: ignore[bad-argument-type]
    dataset.created_at = created_at
    dataset.updated_at = updated_at
    session.add(dataset)
    session.flush()
    return dataset


DATASET_DETAIL_KEYS = {
    "id",
    "name",
    "description",
    "provider",
    "permission",
    "data_source_type",
    "indexing_technique",
    "app_count",
    "document_count",
    "word_count",
    "created_by",
    "author_name",
    "created_at",
    "updated_by",
    "updated_at",
    "embedding_model",
    "embedding_model_provider",
    "embedding_available",
    "retrieval_model_dict",
    "summary_index_setting",
    "tags",
    "doc_form",
    "external_knowledge_info",
    "external_retrieval_model",
    "doc_metadata",
    "built_in_field_enabled",
    "pipeline_id",
    "runtime_mode",
    "chunk_structure",
    "icon_info",
    "is_published",
    "total_documents",
    "total_available_documents",
    "enable_api",
    "is_multimodal",
    "maintainer",
}


def assert_dataset_detail_shape(response: dict[str, object], *, with_partial_members: bool = False) -> None:
    expected_keys = set(DATASET_DETAIL_KEYS)
    if with_partial_members:
        expected_keys.add("partial_member_list")
    assert set(response) == expected_keys
    assert isinstance(response["created_at"], int)
    assert isinstance(response["updated_at"], int)
    retrieval_model = response["retrieval_model_dict"]
    assert isinstance(retrieval_model, dict)
    assert set(retrieval_model) == {
        "search_method",
        "reranking_enable",
        "reranking_mode",
        "reranking_model",
        "weights",
        "top_k",
        "score_threshold_enabled",
        "score_threshold",
    }
    external_retrieval_model = response["external_retrieval_model"]
    if external_retrieval_model is not None:
        assert isinstance(external_retrieval_model, dict)
        assert set(external_retrieval_model) == {
            "top_k",
            "score_threshold",
            "score_threshold_enabled",
        }
    if not with_partial_members:
        assert "partial_member_list" not in response


class TestDatasetApisCases:
    pytestmark = pytest.mark.parametrize("sqlite_session", [DATASET_MODEL_TABLES], indirect=True)

    @staticmethod
    @pytest.fixture
    def controller_session(sqlite_session: Session) -> Session:
        """Expose the shared SQLite session under the controller-focused fixture name."""
        return sqlite_session

    @staticmethod
    @pytest.fixture
    def tenant(controller_session: Session) -> Tenant:
        tenant = Tenant(name="Dataset API Tenant")
        controller_session.add(tenant)
        controller_session.flush()
        return tenant

    @staticmethod
    @pytest.fixture
    def account(controller_session: Session, tenant: Tenant, monkeypatch: pytest.MonkeyPatch) -> Account:
        account = Account(name="Dataset API User", email=f"dataset-api-{uuid.uuid4()}@example.com")
        account.role = TenantAccountRole.OWNER
        account._current_tenant = tenant
        controller_session.add(account)
        controller_session.flush()

        # Inject the concrete account at the controller boundary without relying on Flask-Login globals.
        from controllers.service_api.dataset import dataset as dataset_module

        monkeypatch.setattr(dataset_module, "current_user", account)
        return account

    @staticmethod
    @pytest.fixture
    def dataset(controller_session: Session, tenant: Tenant, account: Account) -> Dataset:
        return make_dataset(controller_session, tenant, account)

    # ---------------------------------------------------------------------------
    # API endpoint tests — DatasetListApi
    # ---------------------------------------------------------------------------

    @pytest.mark.usefixtures("app_query_services")
    class TestDatasetListApiGet:
        """Test suite for DatasetListApi.get() endpoint."""

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_success(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetListApi

            mock_dataset_svc.get_datasets.return_value = ([make_dataset(controller_session, tenant, account)], 1)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=1&limit=20", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert set(response) == {"data", "has_more", "limit", "total", "page"}
            assert response["has_more"] is False
            assert response["limit"] == 20
            assert response["total"] == 1
            assert response["page"] == 1
            assert len(response["data"]) == 1
            assert_dataset_detail_shape(response["data"][0])

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_preserves_repeated_tag_ids(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetListApi

            mock_dataset_svc.get_datasets.return_value = ([make_dataset(controller_session, tenant, account)], 1)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?tag_ids=tag-a&tag_ids=tag-b", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)
                page, limit, session, tenant_id, user, keyword, tag_ids, include_all = (
                    mock_dataset_svc.get_datasets.call_args.args
                )
                assert user is account

            assert status == 200
            assert response["total"] == 1
            assert (page, limit, session, tenant_id, keyword, tag_ids, include_all) == (
                1,
                20,
                controller_session,
                tenant.id,
                None,
                ["tag-a", "tag-b"],
                False,
            )

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_has_more_false_on_last_page_exact_limit(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """A full last page must set has_more false instead of forcing another fetch."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            page_size = 20
            dataset = make_dataset(controller_session, tenant, account)
            mock_dataset_svc.get_datasets.return_value = ([dataset] * page_size, page_size)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context(f"/datasets?page=1&limit={page_size}", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["has_more"] is False
            assert response["limit"] == page_size
            assert response["total"] == page_size
            assert response["page"] == 1

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_has_more_true_when_limit_exceeds_cap(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """limit>100 still reports remaining rows after the server cap of 100."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            returned_count = 100
            total = 150
            dataset = make_dataset(controller_session, tenant, account)
            mock_dataset_svc.get_datasets.return_value = ([dataset] * returned_count, total)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=1&limit=200", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["has_more"] is True
            assert response["limit"] == 100
            assert response["total"] == total
            assert response["page"] == 1
            assert mock_dataset_svc.get_datasets.call_args.args[1] == 100

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_reports_the_page_size_the_query_used_for_limit_zero(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """limit=0 is floored to one row by the query, so the response must report one."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            total = 7
            dataset = make_dataset(controller_session, tenant, account)
            mock_dataset_svc.get_datasets.return_value = ([dataset], total)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=1&limit=0", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["limit"] == 1
            assert response["page"] == 1
            assert response["has_more"] is True
            assert mock_dataset_svc.get_datasets.call_args.args[:2] == (1, 1)

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_has_more_false_past_the_last_page_for_limit_zero(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """A page past the end must end the walk instead of reporting more rows forever."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            total = 7
            mock_dataset_svc.get_datasets.return_value = (list[Dataset](), total)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=8&limit=0", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["has_more"] is False
            assert response["limit"] == 1
            assert response["page"] == 8
            assert response["data"] == []

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_reports_the_page_size_the_query_used_for_negative_limit(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """A negative limit is floored the same way, and is never echoed back."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            total = 7
            dataset = make_dataset(controller_session, tenant, account)
            mock_dataset_svc.get_datasets.return_value = ([dataset], total)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=1&limit=-1", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["limit"] == 1
            assert response["page"] == 1
            assert mock_dataset_svc.get_datasets.call_args.args[:2] == (1, 1)

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_list_datasets_reports_the_page_the_query_used_for_page_zero(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            """page=0 is served as page 1, so the response must not offer page 1 as the next one."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            total = 7
            dataset = make_dataset(controller_session, tenant, account)
            mock_dataset_svc.get_datasets.return_value = ([dataset] * total, total)
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context("/datasets?page=0&limit=20", method="GET"):
                api = DatasetListApi()
                response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert response["page"] == 1
            assert response["has_more"] is False
            assert mock_dataset_svc.get_datasets.call_args.args[:2] == (1, 20)

    class TestDatasetListApiPost:
        """Test suite for DatasetListApi.post() endpoint."""

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_create_dataset_success(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetCreatePayload, DatasetListApi

            mock_dataset_svc.create_empty_dataset.return_value = make_dataset(
                controller_session, tenant, account, name="New Dataset"
            )

            with app.test_request_context(
                "/datasets",
                method="POST",
                json={"name": "New Dataset"},
            ):
                api = DatasetListApi()
                # `post` is wrapped in @model_validate, so the unwrapped view expects
                # the validated model where the decorator would have injected it.
                validated_payload = DatasetCreatePayload.model_validate(request.get_json() or {})
                response, status = unwrap(api.post)(api, validated_payload, controller_session, tenant_id=tenant.id)

            assert status == 200
            assert_dataset_detail_shape(response)
            assert response["name"] == "New Dataset"
            mock_dataset_svc.create_empty_dataset.assert_called_once()

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_create_dataset_duplicate_name(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetCreatePayload, DatasetListApi

            mock_dataset_svc.create_empty_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

            with app.test_request_context(
                "/datasets",
                method="POST",
                json={"name": "Existing Dataset"},
            ):
                api = DatasetListApi()
                validated_payload = DatasetCreatePayload.model_validate(request.get_json() or {})
                with pytest.raises(DatasetNameDuplicateError):
                    unwrap(api.post)(api, validated_payload, controller_session, tenant_id=tenant.id)

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.wraps.FeatureService")
        @patch("controllers.service_api.wraps.validate_and_get_api_token")
        def test_invalid_body_is_rejected_before_the_handler_runs(
            self,
            mock_validate_token: MagicMock,
            mock_feature_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
        ) -> None:
            """The tests above unwrap the view, so this is what covers the decorator."""
            from controllers.service_api.dataset.dataset import DatasetListApi

            mock_validate_token.return_value = SimpleNamespace(tenant_id=tenant.id)
            mock_feature_svc.get_knowledge_rate_limit.return_value = SimpleNamespace(enabled=False)

            with app.test_request_context("/datasets", method="POST", json={}):
                with pytest.raises(UnprocessableEntity):
                    # Admission is tested through the registered route below; retain
                    # the billing/session/payload wrappers for this validation test.
                    DatasetListApi.post.__wrapped__(DatasetListApi(), tenant_id=tenant.id)

    # ---------------------------------------------------------------------------
    # API endpoint tests — DatasetApi
    # ---------------------------------------------------------------------------

    class TestDatasetApiGet:
        """Test suite for DatasetApi.get() endpoint."""

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_get_dataset_success(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="GET",
            ):
                api = DatasetApi()
                response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

            assert status == 200
            assert_dataset_detail_shape(response)
            assert response["embedding_available"] is True
            assert response["retrieval_model_dict"]["search_method"] == "keyword_search"

        @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_get_dataset_partial_members_shape(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            mock_perm_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            dataset.permission = PermissionEnum.PARTIAL_TEAM
            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1", "user-2"]
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="GET",
            ):
                api = DatasetApi()
                response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

            assert status == 200
            assert_dataset_detail_shape(response, with_partial_members=True)
            assert response["partial_member_list"] == ["user-1", "user-2"]

        @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_get_dataset_uses_default_external_retrieval_model(
            self,
            mock_dataset_svc: MagicMock,
            mock_provider_mgr: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            dataset.retrieval_model = None
            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

            with app.test_request_context(f"/datasets/{dataset.id}", method="GET"):
                api = DatasetApi()
                response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

            assert status == 200
            assert_dataset_detail_shape(response)
            assert response["external_retrieval_model"] == {
                "top_k": 2,
                "score_threshold": 0.0,
                "score_threshold_enabled": None,
            }

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_get_dataset_not_found(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.get_dataset.return_value = None

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="GET",
            ):
                api = DatasetApi()
                with pytest.raises(NotFound):
                    unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_get_dataset_no_permission(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.side_effect = services.errors.base.NoPermissionError()

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="GET",
            ):
                api = DatasetApi()
                with pytest.raises(Forbidden):
                    unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

    class TestDatasetApiPatch:
        """Test suite for DatasetApi.patch() endpoint."""

        @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_patch_dataset_success_shape(
            self,
            mock_dataset_svc: MagicMock,
            mock_perm_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi, DatasetUpdatePayload

            dataset.name = "Updated Dataset"
            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.update_dataset.return_value = dataset
            mock_perm_svc.check_permission.return_value = None
            mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1"]

            payload = {
                "name": "Updated Dataset",
                "permission": "partial_members",
                "partial_member_list": [{"user_id": "user-1", "role": "editor"}],
            }
            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="PATCH",
                json=payload,
            ):
                api = DatasetApi()
                # `patch` is wrapped in @model_validate, so the unwrapped view expects
                # the validated model where the decorator would have injected it.
                validated_payload = DatasetUpdatePayload.model_validate(request.get_json() or {})
                response, status = unwrap(api.patch)(
                    api,
                    validated_payload,
                    controller_session,
                    _=dataset.tenant_id,
                    dataset_id=dataset.id,
                )

            assert status == 200
            assert_dataset_detail_shape(response, with_partial_members=True)
            assert response["name"] == "Updated Dataset"
            assert response["partial_member_list"] == ["user-1"]
            mock_dataset_svc.update_dataset.assert_called_once()
            _, update_data, _ = mock_dataset_svc.update_dataset.call_args.args
            session = mock_dataset_svc.update_dataset.call_args.kwargs["session"]
            assert session is controller_session
            assert update_data["name"] == "Updated Dataset"
            assert update_data["permission"] == "partial_members"
            mock_perm_svc.update_partial_member_list.assert_called_once_with(
                dataset.tenant_id,
                dataset.id,
                [{"user_id": "user-1", "role": "editor"}],
                controller_session,
            )

    class TestDatasetApiDelete:
        """Test suite for DatasetApi.delete() endpoint."""

        @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_delete_dataset_success(
            self,
            mock_dataset_svc: MagicMock,
            mock_perm_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.delete_dataset.return_value = True

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="DELETE",
            ):
                api = DatasetApi()
                result = unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

            assert result == ("", 204)
            mock_perm_svc.clear_partial_member_list.assert_called_once_with(dataset.id, controller_session)

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_delete_dataset_not_found(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.delete_dataset.return_value = False

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="DELETE",
            ):
                api = DatasetApi()
                with pytest.raises(NotFound):
                    unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_delete_dataset_in_use(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            dataset: Dataset,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetApi

            mock_dataset_svc.delete_dataset.side_effect = services.errors.dataset.DatasetInUseError()

            with app.test_request_context(
                f"/datasets/{dataset.id}",
                method="DELETE",
            ):
                api = DatasetApi()
                with pytest.raises(DatasetInUseError):
                    unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

    # ---------------------------------------------------------------------------
    # API endpoint tests — DocumentStatusApi
    # ---------------------------------------------------------------------------

    class TestDocumentStatusApiPatch:
        """Test suite for DocumentStatusApi.patch() endpoint."""

        @patch("controllers.service_api.dataset.dataset.DocumentService")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_batch_update_status_success(
            self,
            mock_dataset_svc: MagicMock,
            mock_doc_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            dataset: Dataset,
        ) -> None:
            from controllers.service_api.dataset.dataset import DocumentStatusApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_dataset_svc.check_dataset_model_setting.return_value = None
            mock_doc_svc.batch_update_document_status.return_value = None

            with app.test_request_context(
                f"/datasets/{dataset.id}/documents/status/enable",
                method="PATCH",
                json={"document_ids": ["doc-1", "doc-2"]},
            ):
                api = DocumentStatusApi()
                response, status = api.patch(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    action="enable",
                )

            assert status == 200
            assert response["result"] == "success"

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_batch_update_status_dataset_not_found(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            dataset: Dataset,
        ) -> None:
            from controllers.service_api.dataset.dataset import DocumentStatusApi

            mock_dataset_svc.get_dataset.return_value = None

            with app.test_request_context(
                f"/datasets/{dataset.id}/documents/status/enable",
                method="PATCH",
                json={"document_ids": ["doc-1"]},
            ):
                api = DocumentStatusApi()
                with pytest.raises(NotFound):
                    api.patch(
                        tenant_id=tenant.id,
                        dataset_id=dataset.id,
                        action="enable",
                    )

        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_batch_update_status_permission_error(
            self,
            mock_dataset_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            dataset: Dataset,
        ) -> None:
            from controllers.service_api.dataset.dataset import DocumentStatusApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.side_effect = services.errors.base.NoPermissionError(
                "No permission"
            )

            with app.test_request_context(
                f"/datasets/{dataset.id}/documents/status/enable",
                method="PATCH",
                json={"document_ids": ["doc-1"]},
            ):
                api = DocumentStatusApi()
                with pytest.raises(Forbidden):
                    api.patch(
                        tenant_id=tenant.id,
                        dataset_id=dataset.id,
                        action="enable",
                    )

        @patch("controllers.service_api.dataset.dataset.DocumentService")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_batch_update_status_indexing_error(
            self,
            mock_dataset_svc: MagicMock,
            mock_doc_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            dataset: Dataset,
        ) -> None:
            from controllers.service_api.dataset.dataset import DocumentStatusApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_dataset_svc.check_dataset_model_setting.return_value = None
            mock_doc_svc.batch_update_document_status.side_effect = services.errors.document.DocumentIndexingError()

            with app.test_request_context(
                f"/datasets/{dataset.id}/documents/status/enable",
                method="PATCH",
                json={"document_ids": ["doc-1"]},
            ):
                api = DocumentStatusApi()
                with pytest.raises(InvalidActionError):
                    api.patch(
                        tenant_id=tenant.id,
                        dataset_id=dataset.id,
                        action="enable",
                    )

        @patch("controllers.service_api.dataset.dataset.DocumentService")
        @patch("controllers.service_api.dataset.dataset.DatasetService")
        def test_batch_update_status_value_error(
            self,
            mock_dataset_svc: MagicMock,
            mock_doc_svc: MagicMock,
            app: Flask,
            tenant: Tenant,
            dataset: Dataset,
        ) -> None:
            from controllers.service_api.dataset.dataset import DocumentStatusApi

            mock_dataset_svc.get_dataset.return_value = dataset
            mock_dataset_svc.check_dataset_permission.return_value = None
            mock_dataset_svc.check_dataset_model_setting.return_value = None
            mock_doc_svc.batch_update_document_status.side_effect = ValueError("Invalid action")

            with app.test_request_context(
                f"/datasets/{dataset.id}/documents/status/enable",
                method="PATCH",
                json={"document_ids": ["doc-1"]},
            ):
                api = DocumentStatusApi()
                with pytest.raises(InvalidActionError):
                    api.patch(
                        tenant_id=tenant.id,
                        dataset_id=dataset.id,
                        action="enable",
                    )


"""Unit tests for Service API dataset request payloads."""


class TestDatasetPayloadsCases:
    class TestDatasetCreatePayload:
        """Test suite for DatasetCreatePayload Pydantic model."""

        def test_payload_with_required_name(self) -> None:
            payload = DatasetCreatePayload(name="Test Dataset")
            assert payload.name == "Test Dataset"
            assert payload.description == ""
            assert payload.permission == DatasetPermissionEnum.ONLY_ME

        def test_payload_with_all_fields(self) -> None:
            payload = DatasetCreatePayload(
                name="Full Dataset",
                description="A comprehensive dataset description",
                indexing_technique="high_quality",
                permission=DatasetPermissionEnum.ALL_TEAM,
                provider="vendor",
                embedding_model="text-embedding-ada-002",
                embedding_model_provider="openai",
            )
            assert payload.name == "Full Dataset"
            assert payload.description == "A comprehensive dataset description"
            assert payload.indexing_technique == "high_quality"
            assert payload.permission == DatasetPermissionEnum.ALL_TEAM
            assert payload.provider == "vendor"
            assert payload.embedding_model == "text-embedding-ada-002"
            assert payload.embedding_model_provider == "openai"

        def test_payload_name_length_validation_min(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for DatasetCreatePayload\\\nname"):
                DatasetCreatePayload(name="")

        def test_payload_name_length_validation_max(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for DatasetCreatePayload\\\nname"):
                DatasetCreatePayload(name="A" * 41)

        def test_payload_description_max_length(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for DatasetCreatePayload\\\ndescription"):
                DatasetCreatePayload(name="Dataset", description="A" * 401)

        @pytest.mark.parametrize("technique", ["high_quality", "economy"])
        def test_payload_valid_indexing_techniques(self, technique: Literal["high_quality", "economy"]) -> None:
            payload = DatasetCreatePayload(name="Dataset", indexing_technique=technique)
            assert payload.indexing_technique == technique

        def test_payload_with_external_knowledge_settings(self) -> None:
            payload = DatasetCreatePayload(
                name="External Dataset", external_knowledge_api_id="api_123", external_knowledge_id="knowledge_456"
            )
            assert payload.external_knowledge_api_id == "api_123"
            assert payload.external_knowledge_id == "knowledge_456"

    class TestDatasetUpdatePayload:
        """Test suite for DatasetUpdatePayload Pydantic model."""

        def test_payload_all_optional(self) -> None:
            payload = DatasetUpdatePayload()
            assert payload.name is None
            assert payload.description is None
            assert payload.permission is None

        def test_payload_with_partial_update(self) -> None:
            payload = DatasetUpdatePayload(name="Updated Name", description="Updated description")
            assert payload.name == "Updated Name"
            assert payload.description == "Updated description"

        def test_payload_with_permission_change(self) -> None:
            payload = DatasetUpdatePayload(
                permission=DatasetPermissionEnum.PARTIAL_TEAM,
                partial_member_list=[{"user_id": "user_123", "role": "editor"}],
            )
            assert payload.permission == DatasetPermissionEnum.PARTIAL_TEAM
            assert payload.partial_member_list is not None
            assert len(payload.partial_member_list) == 1

        def test_payload_name_length_validation(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for DatasetUpdatePayload\\\nname"):
                DatasetUpdatePayload(name="")
            with pytest.raises(ValueError, match="1 validation error for DatasetUpdatePayload\\\nname"):
                DatasetUpdatePayload(name="A" * 41)

    class TestDatasetListQuery:
        """Test suite for DatasetListQuery Pydantic model."""

        def test_query_with_defaults(self) -> None:
            query = DatasetListQuery()
            assert query.page == 1
            assert query.limit == 20
            assert query.keyword is None
            assert query.include_all is False
            assert query.tag_ids == []

        def test_query_with_all_filters(self) -> None:
            query = DatasetListQuery(
                page=3, limit=50, keyword="machine learning", include_all=True, tag_ids=["tag1", "tag2", "tag3"]
            )
            assert query.page == 3
            assert query.limit == 50
            assert query.keyword == "machine learning"
            assert query.include_all is True
            assert len(query.tag_ids) == 3

        def test_query_with_tag_filter(self) -> None:
            query = DatasetListQuery(tag_ids=["tag_abc", "tag_def"])
            assert query.tag_ids == ["tag_abc", "tag_def"]

    class TestTagCreatePayload:
        """Test suite for TagCreatePayload Pydantic model."""

        def test_payload_with_name(self) -> None:
            payload = TagCreatePayload(name="New Tag")
            assert payload.name == "New Tag"

        def test_payload_name_length_min(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for TagCreatePayload\\\nname"):
                TagCreatePayload(name="")

        def test_payload_name_length_max(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for TagCreatePayload\\\nname"):
                TagCreatePayload(name="A" * 51)

        def test_payload_with_unicode_name(self) -> None:
            payload = TagCreatePayload(name="标签 🏷️ Тег")
            assert payload.name == "标签 🏷️ Тег"

    class TestTagUpdatePayload:
        """Test suite for TagUpdatePayload Pydantic model."""

        def test_payload_with_name_and_id(self) -> None:
            payload = TagUpdatePayload(name="Updated Tag", tag_id="tag_123")
            assert payload.name == "Updated Tag"
            assert payload.tag_id == "tag_123"

        def test_payload_requires_tag_id(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for TagUpdatePayload\\\ntag_id"):
                TagUpdatePayload.model_validate({"name": "Updated Tag"})

    class TestTagDeletePayload:
        """Test suite for TagDeletePayload Pydantic model."""

        def test_payload_with_tag_id(self) -> None:
            payload = TagDeletePayload(tag_id="tag_to_delete")
            assert payload.tag_id == "tag_to_delete"

        def test_payload_requires_tag_id(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for TagDeletePayload\\\ntag_id"):
                TagDeletePayload.model_validate({})

    class TestTagBindingPayload:
        """Test suite for TagBindingPayload Pydantic model."""

        def test_payload_with_valid_data(self) -> None:
            payload = TagBindingPayload(tag_ids=["tag1", "tag2"], target_id="dataset_123")
            assert len(payload.tag_ids) == 2
            assert payload.target_id == "dataset_123"

        def test_payload_rejects_empty_tag_ids(self) -> None:
            with pytest.raises(ValueError, match="1 validation error for TagBindingPayload\\\ntag_ids") as exc_info:
                TagBindingPayload(tag_ids=[], target_id="dataset_123")
            assert "Tag IDs is required" in str(exc_info.value)

        def test_payload_single_tag_id(self) -> None:
            payload = TagBindingPayload(tag_ids=["single_tag"], target_id="dataset_456")
            assert payload.tag_ids == ["single_tag"]

    class TestTagUnbindingPayload:
        """Test suite for TagUnbindingPayload Pydantic model."""

        def test_payload_with_valid_data(self) -> None:
            payload = TagUnbindingPayload(tag_ids=["tag_123"], target_id="dataset_456")
            assert payload.tag_ids == ["tag_123"]
            assert payload.target_id == "dataset_456"

        def test_payload_normalizes_legacy_tag_id(self) -> None:
            payload = TagUnbindingPayload(tag_id="tag_123", target_id="dataset_456")
            assert payload.tag_ids == ["tag_123"]
            assert payload.target_id == "dataset_456"

        def test_payload_rejects_empty_tag_ids(self) -> None:
            with pytest.raises(
                ValueError,
                match=("1 validation error for TagUnbindingPayload\\\n  Value error, Tag IDs is required\\."),
            ) as exc_info:
                TagUnbindingPayload(tag_ids=[], target_id="dataset_456")
            assert "Tag IDs is required" in str(exc_info.value)


"""Unit tests for Service API dataset tag controller behavior.

Service boundaries stay mocked, while users, tenants, and tags are real ORM objects
persisted in SQLite. Controller database calls share that SQLite session so assertions
cover the concrete objects and session passed across the controller boundary.
"""


TAG_MODEL_TABLES = (Account, Tenant, Tag)


def make_tag(
    session: Session,
    tenant: Tenant,
    account: Account,
    *,
    id: str,
    name: str,
    binding_count: int | None = None,
) -> Tag:
    """Create and flush a real tag, optionally adding the aggregate count returned by TagService."""

    tag = Tag(tenant_id=tenant.id, type=TagType.KNOWLEDGE, name=name, created_by=account.id)
    tag.id = id
    session.add(tag)
    session.flush()
    if binding_count is not None:
        tag.__dict__["binding_count"] = binding_count
    return tag


class TestDatasetTagApisCases:
    pytestmark = pytest.mark.parametrize("sqlite_session", [TAG_MODEL_TABLES], indirect=True)

    @staticmethod
    @pytest.fixture
    def controller_session(sqlite_session: Session) -> Session:
        """Expose the shared SQLite session under the controller-focused fixture name."""
        return sqlite_session

    @staticmethod
    @pytest.fixture
    def tenant(controller_session: Session) -> Tenant:
        tenant = Tenant(name="Dataset Tag API Tenant")
        controller_session.add(tenant)
        controller_session.flush()
        return tenant

    @staticmethod
    @pytest.fixture
    def account(controller_session: Session, tenant: Tenant, monkeypatch: pytest.MonkeyPatch) -> Account:
        account = Account(name="Dataset Tag API User", email=f"dataset-tag-api-{uuid.uuid4()}@example.com")
        account.role = TenantAccountRole.OWNER
        account._current_tenant = tenant
        controller_session.add(account)
        controller_session.flush()

        # Inject the concrete account at the controller boundary without relying on Flask-Login globals.
        from controllers.service_api.dataset import dataset as dataset_module

        monkeypatch.setattr(dataset_module, "current_user", account)
        return account

    class TestDatasetTagsApiGet:
        """Test suite for DatasetTagsApi.get() endpoint."""

        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_list_tags_success(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi

            tag = make_tag(controller_session, tenant, account, id="tag-1", name="Test Tag", binding_count=0)
            mock_tag_svc.get_tags.return_value = [tag]

            with app.test_request_context("/datasets/tags", method="GET"):
                api = DatasetTagsApi()
                response, status = unwrap(api.get)(api, controller_session, _=None)

            assert status == 200
            assert response == [{"id": "tag-1", "name": "Test Tag", "type": "knowledge", "binding_count": "0"}]
            mock_tag_svc.get_tags.assert_called_once_with("knowledge", tenant.id, session=controller_session)

    class TestDatasetTagsApiPost:
        """Test suite for DatasetTagsApi.post() endpoint."""

        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_create_tag_success(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi, TagCreatePayload

            tag = make_tag(controller_session, tenant, account, id="tag-new", name="New Tag")
            mock_tag_svc.save_tags.return_value = tag

            with app.test_request_context(
                "/datasets/tags",
                method="POST",
                json={"name": "New Tag"},
            ):
                api = DatasetTagsApi()
                payload = TagCreatePayload.model_validate(request.get_json() or {})
                response, status = unwrap(api.post)(api, payload, controller_session, _=None)

            assert status == 200
            assert response == {"id": "tag-new", "name": "New Tag", "type": "knowledge", "binding_count": "0"}
            mock_tag_svc.save_tags.assert_called_once()

        def test_create_tag_forbidden(self, app: Flask, account: Account) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi

            account.role = TenantAccountRole.NORMAL

            with app.test_request_context(
                "/datasets/tags",
                method="POST",
                json={"name": "New Tag"},
            ):
                api = DatasetTagsApi()
                with pytest.raises(Forbidden):
                    api.post(_=None)

    class TestDatasetTagsApiPatch:
        """Test suite for DatasetTagsApi.patch() endpoint."""

        @patch("controllers.service_api.dataset.dataset.TagService")
        @patch("controllers.service_api.dataset.dataset.service_api_ns")
        def test_update_tag_success(
            self,
            mock_service_api_ns: MagicMock,
            mock_tag_svc: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi, TagUpdatePayload

            tag = make_tag(controller_session, tenant, account, id="tag-1", name="Updated Tag")
            mock_tag_svc.update_tags.return_value = tag
            mock_tag_svc.get_tag_binding_count.return_value = 5
            mock_service_api_ns.payload = {"name": "Updated Tag", "tag_id": "tag-1"}

            with app.test_request_context(
                "/datasets/tags",
                method="PATCH",
                json={"name": "Updated Tag", "tag_id": "tag-1"},
            ):
                api = DatasetTagsApi()
                payload = TagUpdatePayload.model_validate(request.get_json() or {})
                response, status = unwrap(api.patch)(api, payload, controller_session, _=None)

            assert status == 200
            assert response == {"id": "tag-1", "name": "Updated Tag", "type": "knowledge", "binding_count": "5"}
            mock_tag_svc.update_tags.assert_called_once()
            update_payload, tag_id, session = mock_tag_svc.update_tags.call_args.args
            assert update_payload.name == "Updated Tag"
            assert tag_id == "tag-1"
            assert session is controller_session

        def test_update_tag_forbidden(self, app: Flask, account: Account) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi

            account.role = TenantAccountRole.NORMAL

            with app.test_request_context(
                "/datasets/tags",
                method="PATCH",
                json={"name": "Updated Tag", "tag_id": "tag-1"},
            ):
                api = DatasetTagsApi()
                with pytest.raises(Forbidden):
                    api.patch(_=None)

    class TestDatasetTagsApiDelete:
        """Test suite for DatasetTagsApi.delete() endpoint."""

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.TagService")
        @patch("controllers.service_api.dataset.dataset.service_api_ns")
        def test_delete_tag_success(
            self,
            mock_service_api_ns: MagicMock,
            mock_tag_svc: MagicMock,
            app: Flask,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsApi, TagDeletePayload

            mock_tag_svc.delete_tag.return_value = None
            mock_service_api_ns.payload = {"tag_id": "tag-1"}

            with app.test_request_context(
                "/datasets/tags",
                method="DELETE",
                json={"tag_id": "tag-1"},
            ):
                api = DatasetTagsApi()
                payload = TagDeletePayload.model_validate(request.get_json() or {})
                result = unwrap(api.delete)(api, payload, controller_session, _=None)

            assert result == ("", 204)
            mock_tag_svc.delete_tag.assert_called_once_with("tag-1", controller_session, tag_type=TagType.KNOWLEDGE)

    class TestDatasetTagsBindingStatusApi:
        """Test suite for DatasetTagsBindingStatusApi endpoints."""

        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_get_dataset_tags_binding_status(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            account: Account,
            tenant: Tenant,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagsBindingStatusApi

            tag = make_tag(controller_session, tenant, account, id="tag_1", name="Test Tag")
            mock_tag_svc.get_tags_by_target_id.return_value = [tag]

            with app.test_request_context("/", method="GET"):
                api = DatasetTagsBindingStatusApi()
                response, status_code = unwrap(api.get)(api, controller_session, tenant.id, dataset_id="dataset_123")

            assert status_code == 200
            assert response["data"] == [{"id": "tag_1", "name": "Test Tag"}]
            assert response["total"] == 1
            mock_tag_svc.get_tags_by_target_id.assert_called_once_with(
                "knowledge", tenant.id, "dataset_123", controller_session
            )

    class TestDatasetTagBindingApiPost:
        """Test suite for DatasetTagBindingApi.post() endpoint."""

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_bind_tags_success(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagBindingApi, TagBindingPayload

            mock_tag_svc.save_tag_binding.return_value = None

            with app.test_request_context(
                "/datasets/tags/binding",
                method="POST",
                json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
            ):
                api = DatasetTagBindingApi()
                payload = TagBindingPayload.model_validate(request.get_json() or {})
                result = unwrap(api.post)(api, payload, controller_session, _=None)

            assert result == ("", 204)
            from services.tag_service import TagBindingCreatePayload

            mock_tag_svc.save_tag_binding.assert_called_once_with(
                TagBindingCreatePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
                controller_session,
            )

        def test_bind_tags_forbidden(self, app: Flask, account: Account) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagBindingApi

            account.role = TenantAccountRole.NORMAL

            with app.test_request_context(
                "/datasets/tags/binding",
                method="POST",
                json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
            ):
                api = DatasetTagBindingApi()
                with pytest.raises(Forbidden):
                    api.post(_=None)

    class TestDatasetTagUnbindingApiPost:
        """Test suite for DatasetTagUnbindingApi.post() endpoint."""

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_unbind_tag_success(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi, TagUnbindingPayload

            mock_tag_svc.delete_tag_binding.return_value = None

            with app.test_request_context(
                "/datasets/tags/unbinding",
                method="POST",
                json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
            ):
                api = DatasetTagUnbindingApi()
                payload = TagUnbindingPayload.model_validate(request.get_json() or {})
                result = unwrap(api.post)(api, payload, controller_session, _=None)

            assert result == ("", 204)
            from services.tag_service import TagBindingDeletePayload

            mock_tag_svc.delete_tag_binding.assert_called_once_with(
                TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
                controller_session,
            )

        @pytest.mark.usefixtures("account")
        @patch("controllers.service_api.dataset.dataset.TagService")
        def test_unbind_legacy_tag_id_success(
            self,
            mock_tag_svc: MagicMock,
            app: Flask,
            controller_session: Session,
        ) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi, TagUnbindingPayload

            mock_tag_svc.delete_tag_binding.return_value = None

            with app.test_request_context(
                "/datasets/tags/unbinding",
                method="POST",
                json={"tag_id": "tag-1", "target_id": "ds-1"},
            ):
                api = DatasetTagUnbindingApi()
                payload = TagUnbindingPayload.model_validate(request.get_json() or {})
                result = unwrap(api.post)(api, payload, controller_session, _=None)

            assert result == ("", 204)
            from services.tag_service import TagBindingDeletePayload

            mock_tag_svc.delete_tag_binding.assert_called_once_with(
                TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
                controller_session,
            )

        def test_unbind_tag_forbidden(self, app: Flask, account: Account) -> None:
            from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

            account.role = TenantAccountRole.NORMAL

            with app.test_request_context(
                "/datasets/tags/unbinding",
                method="POST",
                json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
            ):
                api = DatasetTagUnbindingApi()
                with pytest.raises(Forbidden):
                    api.post(_=None)


@dataclass
class ScopedListServices:
    tags: TagRepository


@dataclass
class ScopedListCase:
    client: FlaskClient
    datasets: list[Dataset]
    token: ApiToken
    config: DifyConfig
    session: Session
    tag_id: str

    def bind(self, indices: list[int]) -> None:
        self.session.add_all(
            [DatasetApiTokenBinding(api_token_id=self.token.id, dataset_id=self.datasets[i].id) for i in indices]
        )
        self.session.commit()


class TestScopedDatasetListRoute:
    """Exercise the registered HTTP route, real scope admission and SQL pagination."""

    @pytest.fixture
    def scoped_list(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[ScopedListCase]:
        from flask_login import LoginManager
        from flask_restx import Api
        from sqlalchemy.orm import scoped_session, sessionmaker

        from configs import dify_config
        from controllers.service_api import wraps as auth
        from controllers.service_api.dataset import dataset as endpoint
        from core.entities.provider_configuration import ProviderConfigurations
        from core.provider_manager import ProviderManager
        from models import TenantAccountJoin
        from models.enums import ApiTokenType
        from models.model import ApiToken
        from services.knowledge.dataset_service import DatasetService

        app = Flask(__name__)
        app.config.update(TESTING=True, SECRET_KEY="unit-test")
        LoginManager(app)
        api = Api(app)
        api.add_resource(endpoint.DatasetListApi, "/v1/datasets")
        tenant = Tenant(name="Scope tenant")
        other_tenant = Tenant(name="Other tenant")
        owner = Account(name="Scope owner", email=f"{uuid.uuid4()}@example.com")
        sqlite_session.add_all([tenant, other_tenant, owner])
        sqlite_session.flush()
        owner.role = TenantAccountRole.OWNER
        owner._current_tenant = tenant
        sqlite_session.add(
            TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER, current=True)
        )
        datasets = [
            make_dataset(sqlite_session, tenant, owner, name="Allowed A", maintainer=owner.id, enable_api=True),
            make_dataset(sqlite_session, tenant, owner, name="Allowed B", maintainer=owner.id, enable_api=True),
            make_dataset(sqlite_session, tenant, owner, name="Hidden owned", maintainer=owner.id, enable_api=True),
            make_dataset(sqlite_session, other_tenant, owner, name="Foreign", maintainer=owner.id, enable_api=True),
        ]
        token = ApiToken(tenant_id=tenant.id, type=ApiTokenType.DATASET, token="scoped-route-test")
        sqlite_session.add(token)
        sqlite_session.commit()
        factory = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
        auth_session = scoped_session(factory)
        monkeypatch.setattr(auth.db, "session", auth_session)
        monkeypatch.setattr(auth, "validate_and_get_api_token", lambda _: token)
        monkeypatch.setattr(endpoint, "current_user", owner)
        monkeypatch.setattr(DatasetService, "_can_manage_all_datasets", staticmethod(lambda *_: True))
        monkeypatch.setattr(
            ProviderManager, "get_configurations", lambda _self, tenant_id: ProviderConfigurations(tenant_id)
        )
        services = ScopedListServices(tags=TagRepository(factory))
        monkeypatch.setattr(endpoint, "application_services", lambda: services)
        tag = Tag(tenant_id=tenant.id, type=TagType.KNOWLEDGE, name="Scope tag", created_by=owner.id)
        sqlite_session.add(tag)
        sqlite_session.flush()
        sqlite_session.add_all(
            [
                TagBinding(tenant_id=tenant.id, tag_id=tag.id, target_id=dataset.id, created_by=owner.id)
                for dataset in datasets[:3]
            ]
        )
        sqlite_session.commit()
        monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
        try:
            yield ScopedListCase(app.test_client(), datasets, token, dify_config, sqlite_session, tag.id)
        finally:
            auth_session.remove()

    @pytest.mark.parametrize("rbac", [False, True])
    @pytest.mark.parametrize("include_all", [False, True])
    def test_single_key_never_lists_owned_or_foreign_datasets(
        self, scoped_list: ScopedListCase, monkeypatch: pytest.MonkeyPatch, rbac: bool, include_all: bool
    ) -> None:
        scoped_list.bind([0, 3])  # Even a malformed cross-tenant binding must not leak.
        monkeypatch.setattr(scoped_list.config, "RBAC_ENABLED", rbac)
        response = scoped_list.client.get(f"/v1/datasets?include_all={str(include_all).lower()}")
        assert response.status_code == 200
        body = response.get_json()
        assert [row["id"] for row in body["data"]] == [scoped_list.datasets[0].id]
        assert body["total"] == 1
        assert body["has_more"] is False

    def test_multiple_bindings_filter_before_pagination_and_search(self, scoped_list: ScopedListCase) -> None:
        scoped_list.bind([0, 1])
        first = scoped_list.client.get("/v1/datasets?limit=1&page=1").get_json()
        second = scoped_list.client.get("/v1/datasets?limit=1&page=2").get_json()
        assert first["total"] == second["total"] == 2
        assert first["has_more"] is True
        assert second["has_more"] is False
        assert {first["data"][0]["id"], second["data"][0]["id"]} == {d.id for d in scoped_list.datasets[:2]}
        for query in ("keyword=Hidden", "keyword=Foreign", "page=3&limit=1"):
            assert scoped_list.client.get(f"/v1/datasets?{query}").get_json()["data"] == []
        tagged = scoped_list.client.get(f"/v1/datasets?tag_ids={scoped_list.tag_id}").get_json()
        assert {row["id"] for row in tagged["data"]} == {d.id for d in scoped_list.datasets[:2]}

    @pytest.mark.parametrize("rbac", [False, True])
    @pytest.mark.parametrize("include_all", [False, True])
    def test_unrestricted_key_retains_workspace_results(
        self, scoped_list: ScopedListCase, monkeypatch: pytest.MonkeyPatch, rbac: bool, include_all: bool
    ) -> None:
        monkeypatch.setattr(scoped_list.config, "RBAC_ENABLED", rbac)
        response = scoped_list.client.get(f"/v1/datasets?include_all={str(include_all).lower()}")
        assert response.status_code == 200
        body = response.get_json()
        assert {row["id"] for row in body["data"]} == {d.id for d in scoped_list.datasets[:3]}
        assert body["total"] == 3

    def test_knowledgefs_only_key_has_empty_legacy_list(
        self, scoped_list: ScopedListCase, sqlite_session: Session
    ) -> None:
        from models.enums import ApiTokenBindingResourceType
        from models.model import DatasetApiTokenBinding

        sqlite_session.add(
            DatasetApiTokenBinding(
                api_token_id=scoped_list.token.id,
                resource_type=ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE,
                control_space_id=str(uuid.uuid4()),
            )
        )
        sqlite_session.commit()
        response = scoped_list.client.get("/v1/datasets?include_all=true")
        assert response.status_code == 200
        assert response.get_json()["data"] == []
        assert response.get_json()["total"] == 0

    def test_list_permission_does_not_allow_creation(self, scoped_list: ScopedListCase) -> None:
        scoped_list.bind([0])
        response = scoped_list.client.post("/v1/datasets", json={"name": "Must not create"})
        assert response.status_code == 403
        assert response.get_json()["message"] == "The API key is not authorized to access this knowledge base."

    def test_head_request_still_checks_token_scope(
        self, scoped_list: ScopedListCase, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from werkzeug.exceptions import Unauthorized

        from controllers.service_api import wraps as auth

        def invalid_token(_: str) -> NoReturn:
            raise Unauthorized("invalid token")

        monkeypatch.setattr(auth, "validate_and_get_api_token", invalid_token)
        assert scoped_list.client.head("/v1/datasets").status_code == 401

    def test_deleted_key_cannot_use_cached_identity_to_list(
        self, scoped_list: ScopedListCase, sqlite_session: Session
    ) -> None:
        scoped_list.bind([0])
        sqlite_session.delete(scoped_list.token)
        sqlite_session.commit()
        response = scoped_list.client.get("/v1/datasets")
        assert response.status_code == 401
        assert response.get_json()["message"] == "API key is no longer valid."

    def test_scope_updates_take_effect_on_next_list_request(
        self, scoped_list: ScopedListCase, sqlite_session: Session
    ) -> None:
        from sqlalchemy import update

        from models.model import DatasetApiTokenBinding

        scoped_list.bind([0])
        first = scoped_list.client.get("/v1/datasets").get_json()
        assert [row["id"] for row in first["data"]] == [scoped_list.datasets[0].id]
        sqlite_session.execute(
            update(DatasetApiTokenBinding)
            .where(DatasetApiTokenBinding.api_token_id == scoped_list.token.id)
            .values(dataset_id=scoped_list.datasets[1].id)
        )
        sqlite_session.commit()
        second = scoped_list.client.get("/v1/datasets").get_json()
        assert [row["id"] for row in second["data"]] == [scoped_list.datasets[1].id]

    def test_authorized_but_missing_dataset_does_not_expand_scope(
        self, scoped_list: ScopedListCase, sqlite_session: Session
    ) -> None:
        from models.model import DatasetApiTokenBinding

        sqlite_session.add(DatasetApiTokenBinding(api_token_id=scoped_list.token.id, dataset_id=str(uuid.uuid4())))
        sqlite_session.commit()
        response = scoped_list.client.get("/v1/datasets?include_all=true")
        assert response.status_code == 200
        assert response.get_json()["data"] == []
        assert response.get_json()["total"] == 0

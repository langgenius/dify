"""Unit tests for Service API dataset tag controller behavior.

Service boundaries stay mocked, while users, tenants, and tags are real ORM objects
persisted in SQLite. Controller database calls share that SQLite session so assertions
cover the concrete objects and session passed across the controller boundary.
"""

import uuid
from inspect import unwrap
from typing import cast
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden

from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountRole
from models.enums import TagType
from models.model import Tag

TAG_MODEL_TABLES = (Account, Tenant, Tag)
pytestmark = pytest.mark.parametrize("sqlite_session", [TAG_MODEL_TABLES], indirect=True)


@pytest.fixture(autouse=True)
def controller_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Route controller database access through the test's SQLite session."""

    # Flask-SQLAlchemy exposes a callable registry that also proxies Session methods.
    # Seed that registry with this fixture's Session so both access styles share one transaction.
    existing_session_factory = cast(sessionmaker[Session], lambda: sqlite_session)
    session_registry = scoped_session(existing_session_factory)
    monkeypatch.setattr(db, "session", session_registry)
    return sqlite_session


@pytest.fixture
def tenant(controller_session: Session) -> Tenant:
    tenant = Tenant(name="Dataset Tag API Tenant")
    controller_session.add(tenant)
    controller_session.flush()
    return tenant


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


class TestDatasetTagsApiGet:
    """Test suite for DatasetTagsApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_list_tags_success(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        tag = make_tag(controller_session, tenant, account, id="tag-1", name="Test Tag", binding_count=0)
        mock_tag_svc.get_tags.return_value = [tag]

        with app.test_request_context("/datasets/tags", method="GET"):
            api = DatasetTagsApi()
            response, status = api.get(_=None)

        assert status == 200
        assert response == [{"id": "tag-1", "name": "Test Tag", "type": "knowledge", "binding_count": "0"}]
        mock_tag_svc.get_tags.assert_called_once_with("knowledge", tenant.id, session=controller_session)


class TestDatasetTagsApiPost:
    """Test suite for DatasetTagsApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_create_tag_success(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        tag = make_tag(controller_session, tenant, account, id="tag-new", name="New Tag")
        mock_tag_svc.save_tags.return_value = tag

        with app.test_request_context(
            "/datasets/tags",
            method="POST",
            json={"name": "New Tag"},
        ):
            api = DatasetTagsApi()
            response, status = api.post(_=None)

        assert status == 200
        assert response == {"id": "tag-new", "name": "New Tag", "type": "knowledge", "binding_count": "0"}
        mock_tag_svc.save_tags.assert_called_once()

    def test_create_tag_forbidden(self, app: Flask, account: Account):
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
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

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
            response, status = api.patch(_=None)

        assert status == 200
        assert response == {"id": "tag-1", "name": "Updated Tag", "type": "knowledge", "binding_count": "5"}
        mock_tag_svc.update_tags.assert_called_once()
        update_payload, tag_id, session = mock_tag_svc.update_tags.call_args.args
        assert update_payload.name == "Updated Tag"
        assert tag_id == "tag-1"
        assert session is controller_session

    def test_update_tag_forbidden(self, app: Flask, account: Account):
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

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.service_api_ns")
    def test_delete_tag_success(
        self,
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
        account: Account,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_tag_svc.delete_tag.return_value = None
        mock_service_api_ns.payload = {"tag_id": "tag-1"}

        with app.test_request_context(
            "/datasets/tags",
            method="DELETE",
            json={"tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            result = unwrap(api.delete)(api, _=None)

        assert result == ("", 204)
        mock_tag_svc.delete_tag.assert_called_once_with("tag-1", controller_session, tag_type=TagType.KNOWLEDGE)


class TestDatasetTagsBindingStatusApi:
    """Test suite for DatasetTagsBindingStatusApi endpoints."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_get_dataset_tags_binding_status(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsBindingStatusApi

        tag = make_tag(controller_session, tenant, account, id="tag_1", name="Test Tag")
        mock_tag_svc.get_tags_by_target_id.return_value = [tag]

        with app.test_request_context("/", method="GET"):
            api = DatasetTagsBindingStatusApi()
            response, status_code = api.get(tenant.id, dataset_id="dataset_123")

        assert status_code == 200
        assert response["data"] == [{"id": "tag_1", "name": "Test Tag"}]
        assert response["total"] == 1
        mock_tag_svc.get_tags_by_target_id.assert_called_once_with(
            "knowledge", tenant.id, "dataset_123", controller_session
        )


class TestDatasetTagBindingApiPost:
    """Test suite for DatasetTagBindingApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_bind_tags_success(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagBindingApi

        mock_tag_svc.save_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/binding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagBindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingCreatePayload

        mock_tag_svc.save_tag_binding.assert_called_once_with(
            TagBindingCreatePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            controller_session,
        )

    def test_bind_tags_forbidden(self, app: Flask, account: Account):
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

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_unbind_tag_success(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_tag_svc.delete_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingDeletePayload

        mock_tag_svc.delete_tag_binding.assert_called_once_with(
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            controller_session,
        )

    @patch("controllers.service_api.dataset.dataset.TagService")
    def test_unbind_legacy_tag_id_success(
        self,
        mock_tag_svc,
        app: Flask,
        account: Account,
        controller_session: Session,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_tag_svc.delete_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_id": "tag-1", "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingDeletePayload

        mock_tag_svc.delete_tag_binding.assert_called_once_with(
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            controller_session,
        )

    def test_unbind_tag_forbidden(self, app: Flask, account: Account):
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

"""Unit tests for Service API dataset tag controller behavior."""

from unittest.mock import ANY, Mock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Forbidden

from models.account import Account
from models.enums import TagType
from models.model import Tag


class SessionMatcher:
    def __eq__(self, other):
        return isinstance(other, (Session, scoped_session))


def make_tag(*, id: str, name: str, binding_count: int | None = None) -> Tag:
    tag = Tag(tenant_id="tenant-1", type=TagType.KNOWLEDGE, name=name, created_by="account-1")
    tag.id = id
    if binding_count is not None:
        tag.__dict__["binding_count"] = binding_count
    return tag


class TestDatasetTagsApiGet:
    """Test suite for DatasetTagsApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_list_tags_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = "tenant-1"
        mock_tag = make_tag(id="tag-1", name="Test Tag", binding_count=0)
        mock_tag_svc.get_tags.return_value = [mock_tag]

        with app.test_request_context("/datasets/tags", method="GET"):
            api = DatasetTagsApi()
            response, status = api.get(_=None)

        assert status == 200
        assert response == [{"id": "tag-1", "name": "Test Tag", "type": "knowledge", "binding_count": "0"}]
        mock_tag_svc.get_tags.assert_called_once_with("knowledge", "tenant-1", session=SessionMatcher())


class TestDatasetTagsApiPost:
    """Test suite for DatasetTagsApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag = make_tag(id="tag-new", name="New Tag")
        mock_tag_svc.save_tags.return_value = mock_tag

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

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

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
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_success(
        self,
        mock_current_user,
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True

        mock_tag = make_tag(id="tag-1", name="Updated Tag")
        mock_tag_svc.update_tags.return_value = mock_tag
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

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

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
    @patch("libs.login.current_user")
    def test_delete_tag_success(
        self,
        mock_current_user,
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        user_obj = Mock(spec=Account)
        user_obj.has_edit_permission = True
        mock_current_user.has_edit_permission = True
        # Assign as plain lambda to avoid AsyncMock returning a coroutine
        mock_current_user._get_current_object = lambda: user_obj

        mock_tag_svc.delete_tag.return_value = None
        mock_service_api_ns.payload = {"tag_id": "tag-1"}

        with app.test_request_context(
            "/datasets/tags",
            method="DELETE",
            json={"tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            result = api.delete(_=None)

        assert result == ("", 204)
        mock_tag_svc.delete_tag.assert_called_once_with("tag-1", ANY, tag_type=TagType.KNOWLEDGE)

    @patch("libs.login.current_user")
    def test_delete_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        user_obj = Mock(spec=Account)
        user_obj.has_edit_permission = False
        mock_current_user.has_edit_permission = False
        # Assign as plain lambda to avoid AsyncMock returning a coroutine
        mock_current_user._get_current_object = lambda: user_obj

        with app.test_request_context(
            "/datasets/tags",
            method="DELETE",
            json={"tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            with pytest.raises(Forbidden):
                api.delete(_=None)


class TestDatasetTagsBindingStatusApi:
    """Test suite for DatasetTagsBindingStatusApi endpoints."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_get_dataset_tags_binding_status(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsBindingStatusApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = "tenant_123"
        mock_tag = Mock()
        mock_tag.id = "tag_1"
        mock_tag.name = "Test Tag"
        mock_tag_svc.get_tags_by_target_id.return_value = [mock_tag]

        with app.test_request_context("/", method="GET"):
            api = DatasetTagsBindingStatusApi()
            response, status_code = api.get("tenant_123", dataset_id="dataset_123")

        assert status_code == 200
        assert response["data"] == [{"id": "tag_1", "name": "Test Tag"}]
        assert response["total"] == 1
        mock_tag_svc.get_tags_by_target_id.assert_called_once_with("knowledge", "tenant_123", "dataset_123", ANY)


class TestDatasetTagBindingApiPost:
    """Test suite for DatasetTagBindingApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagBindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
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
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagBindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

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
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_tag_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
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
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_legacy_tag_id_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
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
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            with pytest.raises(Forbidden):
                api.post(_=None)

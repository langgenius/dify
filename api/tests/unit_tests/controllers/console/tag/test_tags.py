from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import controllers.console.tag.tags as module
from controllers.console import console_ns
from controllers.console.tag.tags import (
    TagBindingCollectionApi,
    TagBindingRemoveApi,
    TagListApi,
    TagUpdateDeleteApi,
)
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.enums import TagType
from services.tag_service import UpdateTagPayload


class SessionMatcher:
    def __eq__(self, other):
        return isinstance(other, Session)


def unwrap(func):
    """
    Recursively unwrap decorated functions.
    """
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_tag")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def admin_user():
    account = Account(
        name="Admin User",
        email="admin@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-1"
    account.role = TenantAccountRole.OWNER
    return account


@pytest.fixture
def readonly_user():
    account = Account(
        name="Readonly User",
        email="readonly@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-2"
    account.role = TenantAccountRole.NORMAL
    return account


@pytest.fixture
def tag():
    tag = MagicMock()
    tag.id = "tag-1"
    tag.name = "test-tag"
    tag.type = TagType.KNOWLEDGE
    return tag


@pytest.fixture
def payload_patch():
    def _patch(payload):
        return patch.object(
            type(console_ns),
            "payload",
            new_callable=PropertyMock,
            return_value=payload,
        )

    return _patch


class TestTagListApi:
    def test_get_success(self, app: Flask):
        api = TagListApi()
        method = unwrap(api.get)

        with app.test_request_context("/?type=knowledge"):
            with (
                patch(
                    "controllers.console.tag.tags.TagService.get_tags",
                    return_value=[
                        SimpleNamespace(
                            id="1",
                            name="tag",
                            type=TagType.KNOWLEDGE,
                            binding_count=1,
                        )
                    ],
                ),
            ):
                result, status = method(api, "tenant-1")

        assert status == 200
        assert result == [{"id": "1", "name": "tag", "type": "knowledge", "binding_count": "1"}]

    def test_get_snippet_tags(self, app: Flask):
        api = TagListApi()
        method = unwrap(api.get)

        with app.test_request_context("/?type=snippet"):
            with (
                patch(
                    "controllers.console.tag.tags.TagService.get_tags",
                    return_value=[
                        SimpleNamespace(
                            id="1",
                            name="snippet-tag",
                            type=TagType.SNIPPET,
                            binding_count=1,
                        )
                    ],
                ) as get_tags_mock,
            ):
                result, status = method(api, "tenant-1")

        get_tags_mock.assert_called_once_with("snippet", "tenant-1", None, session=SessionMatcher())
        assert status == 200
        assert result == [{"id": "1", "name": "snippet-tag", "type": "snippet", "binding_count": "1"}]

    def test_post_success(self, app: Flask, admin_user, tag, payload_patch):
        api = TagListApi()
        method = unwrap(api.post)

        payload = {"name": "test-tag", "type": "knowledge"}

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch(
                    "controllers.console.tag.tags.TagService.save_tags",
                    return_value=tag,
                ),
            ):
                result, status = method(api, admin_user)

        assert status == 200
        assert result["name"] == "test-tag"
        assert result["binding_count"] == "0"

    def test_post_snippet_tag_checks_snippet_rbac_when_enabled(self, app: Flask, admin_user, tag, payload_patch):
        api = TagListApi()
        method = unwrap(api.post)

        payload = {"name": "snippet-tag", "type": "snippet"}

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch("controllers.console.tag.tags.dify_config.RBAC_ENABLED", True),
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(SimpleNamespace(id="user-1"), "tenant-1"),
                ),
                patch("controllers.console.tag.tags.enforce_rbac_access") as enforce_mock,
                patch(
                    "controllers.console.tag.tags.TagService.save_tags",
                    return_value=tag,
                ),
            ):
                method(api, admin_user)

        enforce_mock.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="user-1",
            resource_type=module.RBACResourceScope.WORKSPACE,
            scene=module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
            resource_required=False,
        )

    def test_post_forbidden(self, app: Flask, readonly_user, payload_patch):
        api = TagListApi()
        method = unwrap(api.post)

        payload = {"name": "x"}

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
            ):
                with pytest.raises(Forbidden):
                    method(api, readonly_user)


class TestTagUpdateDeleteApi:
    def test_patch_success(self, app: Flask, admin_user, tag, payload_patch):
        api = TagUpdateDeleteApi()
        method = unwrap(api.patch)

        payload = {"name": "updated"}

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch(
                    "controllers.console.tag.tags.TagService.update_tags",
                    return_value=tag,
                ) as update_tags_mock,
                patch(
                    "controllers.console.tag.tags.TagService.get_tag_binding_count",
                    return_value=3,
                ),
            ):
                result, status = method(api, admin_user, "tag-1")

        assert status == 200
        update_payload, tag_id, session = update_tags_mock.call_args.args
        assert update_payload == UpdateTagPayload(name="updated")
        assert tag_id == "tag-1"
        assert session == SessionMatcher()
        assert result["binding_count"] == "3"

    def test_patch_forbidden(self, app: Flask, readonly_user, payload_patch):
        api = TagUpdateDeleteApi()
        method = unwrap(api.patch)

        payload = {"name": "x"}

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
            ):
                with pytest.raises(Forbidden):
                    method(api, readonly_user, "tag-1")

    def test_delete_success(self, app: Flask, admin_user):
        api = TagUpdateDeleteApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch("controllers.console.tag.tags.TagService.delete_tag") as delete_mock,
        ):
            result, status = method(api, "tag-1")

        delete_mock.assert_called_once_with("tag-1", SessionMatcher())
        assert status == 204

    def test_delete_snippet_tag_checks_type_in_current_tenant(self, app: Flask, admin_user):
        api = TagUpdateDeleteApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch("controllers.console.tag.tags.dify_config.RBAC_ENABLED", True),
            patch(
                "controllers.console.tag.tags.current_account_with_tenant",
                return_value=(SimpleNamespace(id="user-1"), "tenant-1"),
            ),
            patch.object(module.db.session, "scalar", return_value=TagType.SNIPPET) as scalar_mock,
            patch("controllers.console.tag.tags.enforce_rbac_access") as enforce_mock,
            patch("controllers.console.tag.tags.TagService.delete_tag") as delete_mock,
        ):
            result, status = method(api, "tag-1")

        scalar_mock.assert_called_once()
        enforce_mock.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="user-1",
            resource_type=module.RBACResourceScope.WORKSPACE,
            scene=module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
            resource_required=False,
        )
        delete_mock.assert_called_once_with("tag-1", SessionMatcher())
        assert result == ""
        assert status == 204


class TestTagBindingCollectionApi:
    def test_create_success(self, app: Flask, admin_user, payload_patch):
        api = TagBindingCollectionApi()
        method = unwrap(api.post)

        payload = {
            "tag_ids": ["tag-1"],
            "target_id": "target-1",
            "type": "knowledge",
        }

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch("controllers.console.tag.tags.TagService.save_tag_binding") as save_mock,
            ):
                result, status = method(api, admin_user)

        save_mock.assert_called_once()
        assert status == 200
        assert result["result"] == "success"

    def test_create_snippet_binding_success(self, app: Flask, admin_user, payload_patch):
        api = TagBindingCollectionApi()
        method = unwrap(api.post)

        payload = {
            "tag_ids": ["tag-1"],
            "target_id": "snippet-1",
            "type": "snippet",
        }

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch("controllers.console.tag.tags.TagService.save_tag_binding") as save_mock,
            ):
                result, status = method(api, admin_user)

        save_mock.assert_called_once()
        binding_payload = save_mock.call_args.args[0]
        assert binding_payload.type == TagType.SNIPPET
        assert binding_payload.target_id == "snippet-1"
        assert status == 200
        assert result["result"] == "success"

    def test_create_forbidden(self, app: Flask, readonly_user, payload_patch):
        api = TagBindingCollectionApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={}):
            with (
                payload_patch({}),
            ):
                with pytest.raises(Forbidden):
                    method(api, readonly_user)


class TestTagBindingRemoveApi:
    def test_remove_success(self, app: Flask, admin_user, payload_patch):
        api = TagBindingRemoveApi()
        method = unwrap(api.post)

        payload = {
            "tag_ids": ["tag-1", "tag-2"],
            "target_id": "target-1",
            "type": "knowledge",
        }

        with app.test_request_context("/", json=payload):
            with (
                payload_patch(payload),
                patch("controllers.console.tag.tags.TagService.delete_tag_binding") as delete_mock,
            ):
                result, status = method(api, admin_user)

        delete_mock.assert_called_once()
        delete_payload = delete_mock.call_args.args[0]
        assert delete_payload.tag_ids == ["tag-1", "tag-2"]
        assert status == 200
        assert result["result"] == "success"

    def test_remove_forbidden(self, app: Flask, readonly_user, payload_patch):
        api = TagBindingRemoveApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={}):
            with (
                payload_patch({}),
            ):
                with pytest.raises(Forbidden):
                    method(api, readonly_user)


class TestTagResponseModel:
    def test_tag_response_normalizes_enum_type(self):
        payload = module.TagResponse.model_validate(
            {"id": "tag-1", "name": "tag", "type": TagType.KNOWLEDGE, "binding_count": 1}
        ).model_dump(mode="json")

        assert payload["type"] == "knowledge"
        assert payload["binding_count"] == "1"


class TestTagBindingRouteMetadata:
    def test_write_routes_are_not_deprecated(self):
        assert TagBindingCollectionApi.post.__apidoc__.get("deprecated") is not True
        assert TagBindingRemoveApi.post.__apidoc__.get("deprecated") is not True

    def test_write_routes_have_stable_operation_ids(self):
        assert TagBindingCollectionApi.post.__apidoc__["id"] == "create_tag_binding"
        assert TagBindingRemoveApi.post.__apidoc__["id"] == "remove_tag_bindings"

    def test_write_routes_are_registered(self):
        route_map = {
            resource.__name__: urls
            for resource, urls, _route_doc, _kwargs in console_ns.resources
            if resource.__name__
            in {
                "TagBindingCollectionApi",
                "TagBindingRemoveApi",
            }
        }

        assert route_map["TagBindingCollectionApi"] == ("/tag-bindings",)
        assert route_map["TagBindingRemoveApi"] == ("/tag-bindings/remove",)

    def test_legacy_write_routes_are_not_registered(self):
        urls = {url for _resource, resource_urls, _route_doc, _kwargs in console_ns.resources for url in resource_urls}

        assert "/tag-bindings/create" not in urls
        assert "/tag-bindings/<uuid:id>" not in urls

from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.tag.tags import (
    TagBindingCreateApi,
    TagBindingDeleteApi,
    TagListApi,
    TagUpdateDeleteApi,
)


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
    return MagicMock(
        id="user-1",
        has_edit_permission=True,
        is_dataset_editor=True,
    )


@pytest.fixture
def readonly_user():
    return MagicMock(
        id="user-2",
        has_edit_permission=False,
        is_dataset_editor=False,
    )


@pytest.fixture
def tag():
    tag = MagicMock()
    tag.id = "tag-1"
    tag.name = "test-tag"
    tag.type = "knowledge"
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
    def test_get_success(self, app):
        api = TagListApi()
        method = unwrap(api.get)

        with app.test_request_context("/?type=knowledge"):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(MagicMock(), "tenant-1"),
                ),
                patch(
                    "controllers.console.tag.tags.TagService.get_tags",
                    return_value=[{"id": "1", "name": "tag"}],
                ),
            ):
                result, status = method(api)

        assert status == 200
        assert isinstance(result, list)

    def test_post_success(self, app, admin_user, tag, payload_patch):
        api = TagListApi()
        method = unwrap(api.post)

        payload = {"name": "test-tag", "type": "knowledge"}

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(admin_user, None),
                ),
                payload_patch(payload),
                patch(
                    "controllers.console.tag.tags.TagService.save_tags",
                    return_value=tag,
                ),
            ):
                result, status = method(api)

        assert status == 200
        assert result["name"] == "test-tag"

    def test_post_forbidden(self, app, readonly_user, payload_patch):
        api = TagListApi()
        method = unwrap(api.post)

        payload = {"name": "x"}

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(readonly_user, None),
                ),
                payload_patch(payload),
            ):
                with pytest.raises(Forbidden):
                    method(api)


class TestTagUpdateDeleteApi:
    def test_patch_success(self, app, admin_user, tag, payload_patch):
        api = TagUpdateDeleteApi()
        method = unwrap(api.patch)

        payload = {"name": "updated", "type": "knowledge"}

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(admin_user, None),
                ),
                payload_patch(payload),
                patch(
                    "controllers.console.tag.tags.TagService.update_tags",
                    return_value=tag,
                ),
                patch(
                    "controllers.console.tag.tags.TagService.get_tag_binding_count",
                    return_value=3,
                ),
            ):
                result, status = method(api, "tag-1")

        assert status == 200
        assert result["binding_count"] == 3

    def test_patch_forbidden(self, app, readonly_user, payload_patch):
        api = TagUpdateDeleteApi()
        method = unwrap(api.patch)

        payload = {"name": "x"}

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(readonly_user, None),
                ),
                payload_patch(payload),
            ):
                with pytest.raises(Forbidden):
                    method(api, "tag-1")

    def test_delete_success(self, app, admin_user):
        api = TagUpdateDeleteApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.tag.tags.current_account_with_tenant",
                return_value=(admin_user, "tenant-1"),
            ),
            patch("controllers.console.tag.tags.TagService.delete_tag") as delete_mock,
        ):
            result, status = method(api, "tag-1")

        delete_mock.assert_called_once_with("tag-1")
        assert status == 204


class TestTagBindingCreateApi:
    def test_create_success(self, app, admin_user, payload_patch):
        api = TagBindingCreateApi()
        method = unwrap(api.post)

        payload = {
            "tag_ids": ["tag-1"],
            "target_id": "target-1",
            "type": "knowledge",
        }

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(admin_user, None),
                ),
                payload_patch(payload),
                patch("controllers.console.tag.tags.TagService.save_tag_binding") as save_mock,
            ):
                result, status = method(api)

        save_mock.assert_called_once()
        assert status == 200
        assert result["result"] == "success"

    def test_create_forbidden(self, app, readonly_user, payload_patch):
        api = TagBindingCreateApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={}):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(readonly_user, None),
                ),
                payload_patch({}),
            ):
                with pytest.raises(Forbidden):
                    method(api)


class TestTagBindingDeleteApi:
    def test_remove_success(self, app, admin_user, payload_patch):
        api = TagBindingDeleteApi()
        method = unwrap(api.post)

        payload = {
            "tag_id": "tag-1",
            "target_id": "target-1",
            "type": "knowledge",
        }

        with app.test_request_context("/", json=payload):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(admin_user, None),
                ),
                payload_patch(payload),
                patch("controllers.console.tag.tags.TagService.delete_tag_binding") as delete_mock,
            ):
                result, status = method(api)

        delete_mock.assert_called_once()
        assert status == 200
        assert result["result"] == "success"

    def test_remove_forbidden(self, app, readonly_user, payload_patch):
        api = TagBindingDeleteApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={}):
            with (
                patch(
                    "controllers.console.tag.tags.current_account_with_tenant",
                    return_value=(readonly_user, None),
                ),
                payload_patch({}),
            ):
                with pytest.raises(Forbidden):
                    method(api)

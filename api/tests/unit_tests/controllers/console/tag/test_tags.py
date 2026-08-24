from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound, UnprocessableEntity

import controllers.console.tag.tags as module
from controllers.console import console_ns
from controllers.console.tag.tags import (
    TagBasePayload,
    TagBindingCollectionApi,
    TagBindingPayload,
    TagBindingRemoveApi,
    TagBindingRemovePayload,
    TagListApi,
    TagListQueryParam,
    TagUpdateDeleteApi,
    TagUpdateRequestPayload,
)
from machinery.context import RequestContext
from models import Account
from models.account import AccountStatus, TenantAccountRole
from models.enums import TagType
from services.tag_application_service import (
    TagApplicationError,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagNameConflictError,
    TagNotFoundError,
    TagSummary,
    UpdateTagInput,
)


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app() -> Flask:
    app = Flask("test_tag")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="user-1",
        active_workspace_id="tenant-1",
    )


def _account(role: TenantAccountRole) -> Account:
    account = Account(
        name="Tag User",
        email=f"{role.value}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = "user-1"
    account.role = role
    return account


@pytest.fixture
def tags_service() -> MagicMock:
    tags = MagicMock()
    with patch.object(module, "application_services", return_value=SimpleNamespace(tags=tags)):
        yield tags


class TestTagListApi:
    @pytest.mark.parametrize("url", ["/", "/?type="])
    def test_get_requires_non_empty_type(self, app: Flask, url: str) -> None:
        class Handler:
            @module.model_validate(TagListQueryParam)
            def get(self, req_data: TagListQueryParam) -> TagListQueryParam:
                return req_data

        with app.test_request_context(url, method="GET"):
            with pytest.raises(UnprocessableEntity):
                Handler().get()

    def test_get_uses_application_service(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.list_tags.return_value = (TagSummary("tag-1", "Tag", "knowledge", 2),)

        with app.test_request_context("/?type=knowledge"):
            result, status = unwrap(TagListApi().get)(
                TagListApi(),
                TagListQueryParam(type="knowledge"),
                request_context,
            )

        tags_service.list_tags.assert_called_once_with(request_context, "knowledge", None)
        assert status == 200
        assert result == [{"id": "tag-1", "name": "Tag", "type": "knowledge", "binding_count": "2"}]

    def test_get_snippet_tags_uses_same_query_boundary(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.list_tags.return_value = (TagSummary("tag-1", "Snippet", "snippet", 1),)

        with app.test_request_context("/?type=snippet"):
            result, status = unwrap(TagListApi().get)(
                TagListApi(),
                TagListQueryParam(type="snippet"),
                request_context,
            )

        tags_service.list_tags.assert_called_once_with(request_context, "snippet", None)
        assert status == 200
        assert result[0]["type"] == "snippet"

    def test_post_preserves_dataset_editor_permission(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_tag.return_value = TagSummary("tag-1", "Tag", "knowledge", 0)
        dataset_operator = _account(TenantAccountRole.DATASET_OPERATOR)

        with (
            app.test_request_context("/", json={"name": "Tag", "type": "knowledge"}),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(dataset_operator, "tenant-1")),
        ):
            result, status = unwrap(TagListApi().post)(
                TagListApi(),
                TagBasePayload(name="Tag", type=TagType.KNOWLEDGE),
                request_context,
            )

        assert status == 200
        assert result["binding_count"] == "0"
        tags_service.create_tag.assert_called_once()

    def test_post_snippet_tag_checks_rbac(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_tag.return_value = TagSummary("tag-1", "Snippet", "snippet", 0)
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_access") as enforce_rbac_access,
        ):
            unwrap(TagListApi().post)(
                TagListApi(),
                TagBasePayload(name="Snippet", type=TagType.SNIPPET),
                request_context,
            )

        enforce_rbac_access.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="user-1",
            resource_type=module.RBACResourceScope.WORKSPACE,
            scene=module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
            resource_required=False,
        )

    def test_post_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(readonly, "tenant-1")),
        ):
            with pytest.raises(Forbidden):
                unwrap(TagListApi().post)(
                    TagListApi(),
                    TagBasePayload(name="Tag", type=TagType.KNOWLEDGE),
                    request_context,
                )

    def test_post_maps_name_conflict_to_legacy_value_error(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_tag.side_effect = TagNameConflictError()
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            with pytest.raises(ValueError, match="Tag name already exists") as exc_info:
                unwrap(TagListApi().post)(
                    TagListApi(),
                    TagBasePayload(name="Tag", type=TagType.KNOWLEDGE),
                    request_context,
                )

        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__ is True

    def test_post_does_not_coerce_unknown_application_error_to_transport_error(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_tag.side_effect = TagApplicationError("unexpected")
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            with pytest.raises(TagApplicationError, match="unexpected"):
                unwrap(TagListApi().post)(
                    TagListApi(),
                    TagBasePayload(name="Tag", type=TagType.KNOWLEDGE),
                    request_context,
                )


class TestTagUpdateDeleteApi:
    def test_patch_authorizes_snippet_before_update(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.get_tag_type.return_value = "snippet"
        tags_service.update_tag.return_value = TagSummary("tag-1", "Updated", "snippet", 3)
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_access") as enforce_rbac_access,
        ):
            result, status = unwrap(TagUpdateDeleteApi().patch)(
                TagUpdateDeleteApi(),
                TagUpdateRequestPayload(name="Updated"),
                request_context,
                "tag-1",
            )

        enforce_rbac_access.assert_called_once_with(
            tenant_id="tenant-1",
            account_id="user-1",
            resource_type=module.RBACResourceScope.WORKSPACE,
            scene=module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
            resource_required=False,
        )
        tags_service.update_tag.assert_called_once_with(request_context, "tag-1", UpdateTagInput(name="Updated"))
        assert status == 200
        assert result["binding_count"] == "3"

    def test_patch_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(readonly, "tenant-1")),
        ):
            with pytest.raises(Forbidden):
                unwrap(TagUpdateDeleteApi().patch)(
                    TagUpdateDeleteApi(),
                    TagUpdateRequestPayload(name="Updated"),
                    request_context,
                    "tag-1",
                )

    def test_patch_maps_missing_tag_to_not_found(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.update_tag.side_effect = TagNotFoundError()
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            with pytest.raises(NotFound, match="Tag not found") as exc_info:
                unwrap(TagUpdateDeleteApi().patch)(
                    TagUpdateDeleteApi(),
                    TagUpdateRequestPayload(name="Updated"),
                    request_context,
                    "tag-1",
                )

        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__ is True

    def test_delete_does_not_grant_dataset_operator_legacy_edit_permission(
        self, app: Flask, request_context: RequestContext
    ) -> None:
        dataset_operator = _account(TenantAccountRole.DATASET_OPERATOR)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(dataset_operator, "tenant-1")),
        ):
            with pytest.raises(Forbidden):
                unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

    def test_delete_calls_application_service(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

        tags_service.delete_tag.assert_called_once_with(request_context, "tag-1")
        assert (result, status) == ("", 204)

    def test_delete_snippet_tag_checks_type_in_current_workspace(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.get_tag_type.return_value = "snippet"
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_access") as enforce_rbac_access,
        ):
            unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

        tags_service.get_tag_type.assert_called_once_with(request_context, "tag-1")
        enforce_rbac_access.assert_called_once()

    def test_delete_does_not_authorize_tag_outside_current_workspace(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.get_tag_type.return_value = None
        tags_service.delete_tag.side_effect = TagNotFoundError()
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_access") as enforce_rbac_access,
        ):
            with pytest.raises(NotFound):
                unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

        enforce_rbac_access.assert_not_called()


class TestTagBindings:
    def test_create_passes_stable_binding_input(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingPayload(
            tag_ids=["tag-1", "tag-2"],
            target_id="snippet-1",
            type=TagType.SNIPPET,
        )

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagBindingCollectionApi().post)(TagBindingCollectionApi(), payload, request_context)

        tags_service.create_bindings.assert_called_once_with(
            request_context,
            TagBindingInput(("tag-1", "tag-2"), "snippet-1", "snippet"),
        )
        assert (result, status) == ({"result": "success"}, 200)

    def test_create_maps_missing_target_to_not_found(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_bindings.side_effect = TagBindingTargetNotFoundError("app")
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingPayload(tag_ids=["tag-1"], target_id="missing", type=TagType.APP)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            with pytest.raises(NotFound, match="App not found") as exc_info:
                unwrap(TagBindingCollectionApi().post)(TagBindingCollectionApi(), payload, request_context)

        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__ is True

    def test_create_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)
        payload = TagBindingPayload(tag_ids=["tag-1"], target_id="app-1", type=TagType.APP)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(readonly, "tenant-1")),
        ):
            with pytest.raises(Forbidden):
                unwrap(TagBindingCollectionApi().post)(TagBindingCollectionApi(), payload, request_context)

    def test_remove_passes_stable_binding_input(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingRemovePayload(
            tag_ids=["tag-1"],
            target_id="app-1",
            type=TagType.APP,
        )

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagBindingRemoveApi().post)(TagBindingRemoveApi(), payload, request_context)

        tags_service.delete_bindings.assert_called_once_with(
            request_context,
            TagBindingInput(("tag-1",), "app-1", "app"),
        )
        assert (result, status) == ({"result": "success"}, 200)

    def test_remove_maps_missing_target_to_not_found(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.delete_bindings.side_effect = TagBindingTargetNotFoundError("knowledge")
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingRemovePayload(tag_ids=["tag-1"], target_id="missing", type=TagType.KNOWLEDGE)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            with pytest.raises(NotFound, match="Dataset not found") as exc_info:
                unwrap(TagBindingRemoveApi().post)(TagBindingRemoveApi(), payload, request_context)

        assert exc_info.value.__cause__ is None
        assert exc_info.value.__suppress_context__ is True

    def test_remove_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)
        payload = TagBindingRemovePayload(tag_ids=["tag-1"], target_id="app-1", type=TagType.APP)

        with (
            app.test_request_context("/"),
            patch.object(module.dify_config, "RBAC_ENABLED", False),
            patch.object(module, "current_account_with_tenant", return_value=(readonly, "tenant-1")),
        ):
            with pytest.raises(Forbidden):
                unwrap(TagBindingRemoveApi().post)(TagBindingRemoveApi(), payload, request_context)


class TestTagResponseAndRoutes:
    def test_tag_response_normalizes_enum_type(self) -> None:
        payload = module.TagResponse.model_validate(
            {"id": "tag-1", "name": "tag", "type": TagType.KNOWLEDGE, "binding_count": 1}
        ).model_dump(mode="json")

        assert payload["type"] == "knowledge"
        assert payload["binding_count"] == "1"

    def test_binding_routes_keep_contract(self) -> None:
        assert TagBindingCollectionApi.post.__apidoc__["id"] == "create_tag_binding"
        assert TagBindingRemoveApi.post.__apidoc__["id"] == "remove_tag_bindings"
        assert TagBindingCollectionApi.post.__apidoc__.get("deprecated") is not True
        assert TagBindingRemoveApi.post.__apidoc__.get("deprecated") is not True

        route_map = {
            resource.__name__: urls
            for resource, urls, _route_doc, _kwargs in console_ns.resources
            if resource.__name__ in {"TagBindingCollectionApi", "TagBindingRemoveApi"}
        }
        assert route_map == {
            "TagBindingCollectionApi": ("/tag-bindings",),
            "TagBindingRemoveApi": ("/tag-bindings/remove",),
        }

        urls = {url for _resource, resource_urls, _route_doc, _kwargs in console_ns.resources for url in resource_urls}
        assert "/tag-bindings/create" not in urls
        assert "/tag-bindings/<uuid:id>" not in urls

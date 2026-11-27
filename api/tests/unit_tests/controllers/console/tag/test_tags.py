from collections.abc import Iterator
from dataclasses import dataclass
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
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
from extensions.application_services.rbac import RBACServices
from machinery.context import RequestContext
from models import Account
from models.account import Tenant, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource
from models.enums import TagType
from models.model import Tag, TagBinding
from repositories.tag_repository import TagRepository
from services.tag_application_service import (
    CreateTagInput,
    TagApplicationError,
    TagApplicationService,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagKind,
    TagNameConflictError,
    TagNotFoundError,
    TagSummary,
    UpdateTagInput,
)
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.model_factories import make_account
from tests.helpers.unit.rbac_fakes import RBACDomain


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
    return make_account(account_id="user-1", name="Tag User", email=f"{role.value}@example.com", role=role)


@pytest.fixture
def tags_service() -> Iterator[MagicMock]:
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

    def test_get_skill_tags_uses_same_query_boundary(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.list_tags.return_value = (TagSummary("tag-1", "Skill", "skill", 1),)

        with app.test_request_context("/?type=skill"):
            result, status = unwrap(TagListApi().get)(
                TagListApi(),
                TagListQueryParam(type="skill"),
                request_context,
            )

        tags_service.list_tags.assert_called_once_with(request_context, "skill", None)
        assert status == 200
        assert result[0]["type"] == "skill"

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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_checks") as enforce_rbac_checks,
        ):
            unwrap(TagListApi().post)(
                TagListApi(),
                TagBasePayload(name="Snippet", type=TagType.SNIPPET),
                request_context,
            )

        enforce_rbac_checks.assert_called_once()
        rbac_kwargs = enforce_rbac_checks.call_args.kwargs
        assert rbac_kwargs["tenant_id"] == "tenant-1"
        assert rbac_kwargs["account_id"] == "user-1"
        (rbac_check,) = rbac_kwargs["checks"]
        assert rbac_check.scene is module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY
        assert isinstance(rbac_check.locator, module.Workspace)

    def test_post_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_checks") as enforce_rbac_checks,
        ):
            result, status = unwrap(TagUpdateDeleteApi().patch)(
                TagUpdateDeleteApi(),
                TagUpdateRequestPayload(name="Updated"),
                request_context,
                "tag-1",
            )

        enforce_rbac_checks.assert_called_once()
        rbac_kwargs = enforce_rbac_checks.call_args.kwargs
        assert rbac_kwargs["tenant_id"] == "tenant-1"
        assert rbac_kwargs["account_id"] == "user-1"
        (rbac_check,) = rbac_kwargs["checks"]
        assert rbac_check.scene is module.RBACPermission.SNIPPETS_CREATE_AND_MODIFY
        assert isinstance(rbac_check.locator, module.Workspace)
        tags_service.update_tag.assert_called_once_with(request_context, "tag-1", UpdateTagInput(name="Updated"))
        assert status == 200
        assert result["binding_count"] == "3"

    def test_patch_rejects_read_only_member(self, app: Flask, request_context: RequestContext) -> None:
        readonly = _account(TenantAccountRole.NORMAL)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_checks") as enforce_rbac_checks,
        ):
            unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

        tags_service.get_tag_type.assert_called_once_with(request_context, "tag-1")
        enforce_rbac_checks.assert_called_once()

    def test_delete_does_not_authorize_tag_outside_current_workspace(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.get_tag_type.return_value = None
        tags_service.delete_tag.side_effect = TagNotFoundError()
        owner = _account(TenantAccountRole.OWNER)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=True),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
            patch.object(module, "enforce_rbac_checks") as enforce_rbac_checks,
        ):
            with pytest.raises(NotFound):
                unwrap(TagUpdateDeleteApi().delete)(TagUpdateDeleteApi(), request_context, "tag-1")

        enforce_rbac_checks.assert_not_called()


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
            config_overrides_context(RBAC_ENABLED=False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagBindingCollectionApi().post)(TagBindingCollectionApi(), payload, request_context)

        tags_service.create_bindings.assert_called_once_with(
            request_context,
            TagBindingInput(("tag-1", "tag-2"), "snippet-1", TagKind.SNIPPET),
        )
        assert (result, status) == ({"result": "success"}, 200)

    def test_create_passes_skill_binding_input(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingPayload(tag_ids=["tag-1"], target_id="skill-1", type=TagType.SKILL)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagBindingCollectionApi().post)(TagBindingCollectionApi(), payload, request_context)

        tags_service.create_bindings.assert_called_once_with(
            request_context,
            TagBindingInput(("tag-1",), "skill-1", TagKind.SKILL),
        )
        assert (result, status) == ({"result": "success"}, 200)

    def test_create_maps_missing_target_to_not_found(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.create_bindings.side_effect = TagBindingTargetNotFoundError(TagKind.APP)
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingPayload(tag_ids=["tag-1"], target_id="missing", type=TagType.APP)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
            patch.object(module, "current_account_with_tenant", return_value=(owner, "tenant-1")),
        ):
            result, status = unwrap(TagBindingRemoveApi().post)(TagBindingRemoveApi(), payload, request_context)

        tags_service.delete_bindings.assert_called_once_with(
            request_context,
            TagBindingInput(("tag-1",), "app-1", TagKind.APP),
        )
        assert (result, status) == ({"result": "success"}, 200)

    def test_remove_maps_missing_target_to_not_found(
        self, app: Flask, request_context: RequestContext, tags_service: MagicMock
    ) -> None:
        tags_service.delete_bindings.side_effect = TagBindingTargetNotFoundError(TagKind.KNOWLEDGE)
        owner = _account(TenantAccountRole.OWNER)
        payload = TagBindingRemovePayload(tag_ids=["tag-1"], target_id="missing", type=TagType.KNOWLEDGE)

        with (
            app.test_request_context("/"),
            config_overrides_context(RBAC_ENABLED=False),
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
            config_overrides_context(RBAC_ENABLED=False),
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
        post_doc = TagBindingCollectionApi.post.__apidoc__  # pyrefly: ignore[missing-attribute]
        remove_doc = TagBindingRemoveApi.post.__apidoc__  # pyrefly: ignore[missing-attribute]
        assert post_doc["id"] == "create_tag_binding"
        assert remove_doc["id"] == "remove_tag_bindings"
        assert post_doc.get("deprecated") is not True
        assert remove_doc.get("deprecated") is not True

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


@dataclass(frozen=True)
class _AgentTagApplicationServices:
    tags: TagApplicationService
    rbac: RBACServices


AGENT_TAG_TARGET_ID = "a0000000-0000-4000-8000-000000000001"


@pytest.fixture
def agent_tag_services(
    app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TagApplicationService, Account]:
    """Bind real tag persistence and RBAC queries; only the external transport is an explicit fake."""
    tags = TagApplicationService(tags=TagRepository(sqlite_session_factory))
    services = _AgentTagApplicationServices(tags=tags, rbac=rbac_domain.rbac)
    app.extensions["application_services"] = services
    account = _account(TenantAccountRole.NORMAL)
    monkeypatch.setattr(module, "current_account_with_tenant", lambda: (account, "tenant-1"))
    with sqlite_session_factory.begin() as session:
        workspace = Tenant(name="Agent workspace")
        workspace.id = "tenant-1"
        session.add(workspace)
        session.add(
            Agent(
                id=AGENT_TAG_TARGET_ID,
                tenant_id="tenant-1",
                name="Research Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                created_by="another-account",
            )
        )
    return tags, account


@pytest.mark.parametrize("operation", ["create", "rename", "delete"])
@pytest.mark.parametrize("allowed", [False, True])
def test_agent_tag_management_honors_custom_workspace_permission(
    app: Flask,
    request_context: RequestContext,
    agent_tag_services: tuple[TagApplicationService, Account],
    rbac_domain: RBACDomain,
    sqlite_session_factory: sessionmaker[Session],
    operation: str,
    allowed: bool,
) -> None:
    """A custom role's grant controls each Agent tag mutation independently of the legacy member role."""
    tags, account = agent_tag_services
    existing = tags.create_tag(request_context, CreateTagInput("Original", TagKind.AGENT))
    rbac_domain.transport.response = {"allowed": allowed}
    assert account.role == TenantAccountRole.NORMAL

    def mutate() -> object:
        if operation == "create":
            return unwrap(TagListApi.post)(
                TagListApi(), TagBasePayload(name="Research", type=TagType.AGENT), request_context
            )
        if operation == "rename":
            return unwrap(TagUpdateDeleteApi.patch)(
                TagUpdateDeleteApi(), TagUpdateRequestPayload(name="Renamed"), request_context, existing.id
            )
        return unwrap(TagUpdateDeleteApi.delete)(TagUpdateDeleteApi(), request_context, existing.id)

    with app.test_request_context("/"), config_overrides_context(RBAC_ENABLED=True):
        if allowed:
            mutate()
        else:
            with pytest.raises(Forbidden):
                mutate()

    authorization = rbac_domain.transport.only_request
    assert authorization.tenant_id == "tenant-1"
    assert authorization.account_id == "user-1"
    assert authorization.json == {
        "account_id": "user-1",
        "tenant_id": "tenant-1",
        "scene": module.RBACPermission.AGENT_TAG_MANAGE,
    }
    with sqlite_session_factory() as session:
        names = set(session.scalars(select(Tag.name).where(Tag.type == TagType.AGENT)).all())
    expected = {"Original"}
    if allowed:
        expected = (
            {"Original", "Research"} if operation == "create" else {"Renamed"} if operation == "rename" else set()
        )
    assert names == expected


@pytest.mark.parametrize("remove", [False, True])
@pytest.mark.parametrize("allowed", [False, True])
def test_agent_tag_binding_requires_target_edit_permission(
    app: Flask,
    request_context: RequestContext,
    agent_tag_services: tuple[TagApplicationService, Account],
    rbac_domain: RBACDomain,
    sqlite_session_factory: sessionmaker[Session],
    remove: bool,
    allowed: bool,
) -> None:
    """An Agent edit grant, rather than shared-tag management, controls binding and unbinding."""
    tags, _account_model = agent_tag_services
    tag = tags.create_tag(request_context, CreateTagInput("Research", TagKind.AGENT))
    if remove:
        tags.create_bindings(request_context, TagBindingInput((tag.id,), AGENT_TAG_TARGET_ID, TagKind.AGENT))
    rbac_domain.transport.response = {"allowed": allowed}
    resource = TagBindingRemoveApi() if remove else TagBindingCollectionApi()
    payload = (
        TagBindingRemovePayload(tag_ids=[tag.id], target_id=AGENT_TAG_TARGET_ID, type=TagType.AGENT)
        if remove
        else TagBindingPayload(tag_ids=[tag.id], target_id=AGENT_TAG_TARGET_ID, type=TagType.AGENT)
    )
    with app.test_request_context("/"), config_overrides_context(RBAC_ENABLED=True):
        if allowed:
            assert unwrap(resource.post)(resource, payload, request_context) == ({"result": "success"}, 200)
        else:
            with pytest.raises(Forbidden):
                unwrap(resource.post)(resource, payload, request_context)

    authorization = rbac_domain.transport.only_request
    assert authorization.json == {
        "account_id": "user-1",
        "tenant_id": "tenant-1",
        "scene": module.RBACPermission.AGENT_EDIT,
        "resource_type": "agent",
        "resource_id": AGENT_TAG_TARGET_ID,
    }
    with sqlite_session_factory() as session:
        bound = session.scalar(select(TagBinding.id).where(TagBinding.tag_id == tag.id)) is not None
    assert bound is (not remove if allowed else remove)


@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_agent_tags_keep_legacy_edit_roles_when_rbac_is_disabled(
    app: Flask,
    request_context: RequestContext,
    agent_tag_services: tuple[TagApplicationService, Account],
    role: TenantAccountRole,
) -> None:
    """Only Owner, Admin and Editor can manage or bind Agent tags without RBAC."""
    tags, account = agent_tag_services
    account.role = role
    existing = tags.create_tag(request_context, CreateTagInput("Existing", TagKind.AGENT))
    allowed = role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}
    with app.test_request_context("/"), config_overrides_context(RBAC_ENABLED=False):
        if allowed:
            created, _status = unwrap(TagListApi.post)(
                TagListApi(), TagBasePayload(name="Research", type=TagType.AGENT), request_context
            )
            assert created["type"] == "agent"
            assert module._create_tag_bindings(
                request_context,
                TagBindingPayload(tag_ids=[existing.id], target_id=AGENT_TAG_TARGET_ID, type=TagType.AGENT),
            ) == ({"result": "success"}, 200)
        else:
            with pytest.raises(Forbidden):
                unwrap(TagListApi.post)(
                    TagListApi(), TagBasePayload(name="Research", type=TagType.AGENT), request_context
                )
            with pytest.raises(Forbidden):
                module._create_tag_bindings(
                    request_context,
                    TagBindingPayload(tag_ids=[existing.id], target_id=AGENT_TAG_TARGET_ID, type=TagType.AGENT),
                )
            with pytest.raises(Forbidden):
                unwrap(TagUpdateDeleteApi.patch)(
                    TagUpdateDeleteApi(), TagUpdateRequestPayload(name="Renamed"), request_context, existing.id
                )


def test_agent_tag_list_query_accepts_independent_pool() -> None:
    """The shared tags query schema accepts Agent tags without aliasing the App pool."""
    assert TagListQueryParam(type="agent").type == "agent"

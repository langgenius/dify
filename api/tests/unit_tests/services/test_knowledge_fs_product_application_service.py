from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast
from unittest.mock import patch

import pytest

from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
)
from services.knowledge_fs.control_plane_service import KnowledgeFSControlPlaneService
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_application_service import KnowledgeFSProductApplicationService
from services.knowledge_fs.product_authorization import (
    DifyKnowledgeFSProductRBACPort,
    KnowledgeFSProductPermission,
    KnowledgeFSProductRBACPort,
)
from services.knowledge_fs.product_dto import KnowledgeFSSpaceCreatePayload, KnowledgeFSSpaceUpdatePayload
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
)
from services.knowledge_fs.product_service import KnowledgeFSProductService
from tests.unit_tests.config_override import apply_config_overrides


class RejectingProduct:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def require_product_routes(self, *, tenant_id: str) -> None:
        self.calls.append(tenant_id)
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")


class UnexpectedRBAC:
    def workspace_permission_allowed(self, **_: object) -> bool:
        raise AssertionError("RBAC must not run before cutover admission")


def test_space_creation_rejects_an_uncutover_workspace_before_any_mutation() -> None:
    product = RejectingProduct()
    application = KnowledgeFSProductApplicationService(
        product=cast(KnowledgeFSProductService, product),
        control_plane=cast(KnowledgeFSControlPlaneService, object()),
        commands=cast(KnowledgeFSControlSpaceCommandService, object()),
        facade=cast(KnowledgeFSDataFacade, object()),
        rbac=cast(KnowledgeFSProductRBACPort, UnexpectedRBAC()),
    )
    payload = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Blocked space",
            "slug": "blocked-space",
            "embedding": {"pluginId": "plugin", "provider": "provider", "model": "embedding"},
            "retrieval": {
                "defaultMode": "research",
                "reasoningModel": {"pluginId": "plugin", "provider": "provider", "model": "reasoning"},
                "rerank": {
                    "enabled": True,
                    "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
                },
                "scoreThreshold": {"enabled": False},
                "topK": 10,
            },
        }
    )

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="not cut over"):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    assert product.calls == ["tenant-1"]


def _create_payload(**updates: object) -> KnowledgeFSSpaceCreatePayload:
    payload: dict[str, object] = {
        "name": "Product space",
        "slug": "product-space",
        "embedding": {"pluginId": "plugin", "provider": "provider", "model": "embedding"},
        "retrieval": {
            "defaultMode": "research",
            "reasoningModel": {"pluginId": "plugin", "provider": "provider", "model": "reasoning"},
            "rerank": {
                "enabled": True,
                "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
            },
            "scoreThreshold": {"enabled": True, "stage": "mode-final", "value": 0.5},
            "topK": 10,
        },
    }
    payload.update(updates)
    return KnowledgeFSSpaceCreatePayload.model_validate(payload)


def test_space_payloads_share_the_40_character_name_limit() -> None:
    assert len(_create_payload(name="n" * 40).name) == 40
    assert len(KnowledgeFSSpaceUpdatePayload(name="n" * 40).name or "") == 40

    with pytest.raises(ValueError):
        _create_payload(name="n" * 41)
    with pytest.raises(ValueError):
        KnowledgeFSSpaceUpdatePayload(name="n" * 41)

    for icon in ("grinning", "slightly_smiling_face", "+1", "builtin:camera-spec"):
        assert KnowledgeFSSpaceUpdatePayload(icon=icon).icon == icon
    for icon in ("https://example.com/icon.png", "builtin:Camera", "x" * 65):
        with pytest.raises(ValueError):
            KnowledgeFSSpaceUpdatePayload(icon=icon)
    assert KnowledgeFSSpaceUpdatePayload(icon_background="#FCE7F6").icon_background == "#FCE7F6"
    for icon_background in ("FCE7F6", "#fff", "#GGGGGG"):
        with pytest.raises(ValueError):
            KnowledgeFSSpaceUpdatePayload(icon_background=icon_background)


def _control_space(
    *, state: KnowledgeFSControlSpaceState = KnowledgeFSControlSpaceState.ACTIVE
) -> KnowledgeFSControlSpace:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="dify:tenant-1:product-space",
        knowledge_space_id="space-1",
        state=state,
    )
    control_space.id = "control-1"
    return control_space


@dataclass
class _ProvisionResult:
    control_space: KnowledgeFSControlSpace
    model_setup_required: bool


@dataclass
class _AuthorizedControlSpace:
    control_space: KnowledgeFSControlSpace


@dataclass
class _TechnicalSummary:
    knowledge_space_id: str
    revision: int


@dataclass
class _SpaceDetail:
    technical_summary: _TechnicalSummary | None


@dataclass
class FakeProduct:
    """Product reads; get_space replays queued results before falling back to `space_detail`."""

    list_result: object = None
    space_detail: object = None
    queued_space_details: list[object] = field(default_factory=list)
    require_product_routes_calls: list[dict[str, object]] = field(default_factory=list)
    list_spaces_calls: list[dict[str, object]] = field(default_factory=list)
    get_space_calls: list[dict[str, object]] = field(default_factory=list)
    authorize_control_space_calls: list[dict[str, object]] = field(default_factory=list)

    def require_product_routes(self, **kwargs: object) -> None:
        self.require_product_routes_calls.append(kwargs)

    def list_spaces(self, **kwargs: object) -> object:
        self.list_spaces_calls.append(kwargs)
        return self.list_result

    def get_space(self, **kwargs: object) -> object:
        self.get_space_calls.append(kwargs)
        if self.queued_space_details:
            return self.queued_space_details.pop(0)
        return self.space_detail

    def authorize_control_space(self, **kwargs: object) -> _AuthorizedControlSpace:
        self.authorize_control_space_calls.append(kwargs)
        return _AuthorizedControlSpace(control_space=_control_space())


@dataclass
class FakeControlPlane:
    update_visibility_calls: list[dict[str, object]] = field(default_factory=list)
    replace_members_calls: list[dict[str, object]] = field(default_factory=list)
    update_icon_background_calls: list[dict[str, object]] = field(default_factory=list)
    advance_knowledge_space_revision_calls: list[dict[str, object]] = field(default_factory=list)

    def update_visibility(self, **kwargs: object) -> None:
        self.update_visibility_calls.append(kwargs)

    def replace_members(self, **kwargs: object) -> None:
        self.replace_members_calls.append(kwargs)

    def update_icon_background(self, **kwargs: object) -> None:
        self.update_icon_background_calls.append(kwargs)

    def advance_knowledge_space_revision(self, **kwargs: object) -> None:
        self.advance_knowledge_space_revision_calls.append(kwargs)


@dataclass
class FakeCommands:
    provision_result: _ProvisionResult = field(
        default_factory=lambda: _ProvisionResult(
            control_space=_control_space(state=KnowledgeFSControlSpaceState.PROVISIONING),
            model_setup_required=False,
        )
    )
    provision_intents: list[KnowledgeFSProvisionIntent] = field(default_factory=list)
    request_deletion_calls: list[dict[str, object]] = field(default_factory=list)

    def create_provision_intent(self, intent: KnowledgeFSProvisionIntent) -> _ProvisionResult:
        self.provision_intents.append(intent)
        return self.provision_result

    def request_deletion(self, **kwargs: object) -> None:
        self.request_deletion_calls.append(kwargs)


@dataclass
class FakeFacade:
    """Replays queued update_space outcomes; exceptions are raised in order."""

    update_space_results: list[object] = field(default_factory=list)
    update_space_calls: list[dict[str, object]] = field(default_factory=list)
    update_space_payloads: list[KnowledgeFSSpaceUpdatePayload] = field(default_factory=list)

    def update_space(
        self, *, tenant_id: str, account_id: str, control_space_id: str, payload: KnowledgeFSSpaceUpdatePayload
    ) -> object:
        self.update_space_calls.append(
            {"tenant_id": tenant_id, "account_id": account_id, "control_space_id": control_space_id, "payload": payload}
        )
        self.update_space_payloads.append(payload)
        result = self.update_space_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


@dataclass
class FakeRBAC:
    """Answers permission checks from a decision function or a queue of booleans."""

    allowed: bool = True
    queued_decisions: list[bool] = field(default_factory=list)
    decide: Callable[..., bool] | None = None
    permissions: list[KnowledgeFSProductPermission] = field(default_factory=list)

    def workspace_permission_allowed(
        self, *, tenant_id: str, account_id: str, permission: KnowledgeFSProductPermission
    ) -> bool:
        self.permissions.append(permission)
        if self.decide is not None:
            return self.decide(tenant_id=tenant_id, account_id=account_id, permission=permission)
        if self.queued_decisions:
            return self.queued_decisions.pop(0)
        return self.allowed


def _application(
    *, allowed: bool = True
) -> tuple[KnowledgeFSProductApplicationService, FakeProduct, FakeControlPlane, FakeCommands, FakeFacade, FakeRBAC]:
    product = FakeProduct()
    control_plane = FakeControlPlane()
    commands = FakeCommands()
    facade = FakeFacade()
    rbac = FakeRBAC(allowed=allowed)
    application = KnowledgeFSProductApplicationService(
        product=cast(KnowledgeFSProductService, product),
        control_plane=cast(KnowledgeFSControlPlaneService, control_plane),
        commands=cast(KnowledgeFSControlSpaceCommandService, commands),
        facade=cast(KnowledgeFSDataFacade, facade),
        rbac=cast(KnowledgeFSProductRBACPort, rbac),
    )
    return application, product, control_plane, commands, facade, rbac


def test_product_application_delegates_reads_without_reauthorizing() -> None:
    application, product, _control_plane, _commands, _facade, _rbac = _application()
    listed = object()
    detail = object()
    product.list_result = listed
    product.space_detail = detail

    assert (
        application.list_spaces(
            tenant_id="tenant-1",
            account_id="account-1",
            page=2,
            limit=25,
            creator_ids=["creator-1", "creator-2"],
            query="support",
        )
        is listed
    )
    assert application.get_space(tenant_id="tenant-1", account_id="account-1", control_space_id="control-1") is detail
    assert product.list_spaces_calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "page": 2,
            "limit": 25,
            "creator_ids": ["creator-1", "creator-2"],
            "tag_ids": None,
            "query": "support",
        }
    ]
    assert product.get_space_calls == [
        {"tenant_id": "tenant-1", "account_id": "account-1", "control_space_id": "control-1"}
    ]


def test_product_application_create_enforces_workspace_rbac_before_command() -> None:
    application, product, _control_plane, commands, _facade, rbac = _application(allowed=False)

    with pytest.raises(PermissionError, match="creation is not allowed"):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=_create_payload())

    assert product.require_product_routes_calls == [{"tenant_id": "tenant-1"}]
    assert len(rbac.permissions) == 1
    assert commands.provision_intents == []


def test_product_application_create_preserves_model_profile_and_visibility_in_one_intent() -> None:
    application, product, control_plane, commands, _facade, _rbac = _application()
    payload = _create_payload(
        idempotency_key="create-once",
        visibility="all_team_members",
    )

    with patch(
        "services.knowledge_fs.product_application_service.uuid.uuid5",
        return_value="operation-1",
    ):
        response = application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    assert response.control_space_id == "control-1"
    assert response.operation_id == "operation-1"
    assert response.model_setup_required is False
    assert product.require_product_routes_calls == [{"tenant_id": "tenant-1"}]
    intent = commands.provision_intents[-1]
    assert intent.idempotency_key == "create-once"
    assert intent.model_intent == {"pluginId": "plugin", "provider": "provider", "model": "embedding"}
    assert intent.profile_intent is not None
    assert intent.profile_intent["rerank"] == {
        "enabled": True,
        "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
    }
    assert intent.profile_intent["scoreThreshold"] == {
        "enabled": True,
        "stage": "mode-final",
        "value": 0.5,
    }
    assert intent.visibility is KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS
    assert intent.member_account_ids == ()
    assert control_plane.update_visibility_calls == []
    assert control_plane.replace_members_calls == []


def test_product_application_create_passes_initial_viewers_in_the_atomic_intent() -> None:
    application, _product, control_plane, commands, _facade, rbac = _application()
    payload = _create_payload(
        visibility="partial_members",
        members=[{"account_id": "member-1", "role": "viewer"}],
    )

    application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    intent = commands.provision_intents[-1]
    assert intent.visibility is KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
    assert intent.member_account_ids == ("member-1",)
    assert [permission.value for permission in rbac.permissions] == [
        "knowledge_space_create",
        "knowledge_space_access_config",
    ]
    assert control_plane.update_visibility_calls == []
    assert control_plane.replace_members_calls == []


@pytest.mark.parametrize("visibility", ["all_team_members", "partial_members"])
def test_product_application_create_cannot_share_without_access_configuration_permission(visibility: str) -> None:
    application, _product, _control_plane, commands, _facade, rbac = _application()
    rbac.queued_decisions = [True, False]
    payload = _create_payload(
        visibility=visibility,
        members=[{"account_id": "member-1", "role": "viewer"}] if visibility == "partial_members" else [],
    )

    with pytest.raises(PermissionError, match="initial access configuration"):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    assert commands.provision_intents == []


@pytest.mark.parametrize("visibility", ["all_team_members", "partial_members"])
def test_product_application_create_shared_space_without_enterprise_rbac(
    visibility: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    application, _product, _control_plane, commands, _facade, rbac = _application()
    rbac.decide = DifyKnowledgeFSProductRBACPort().workspace_permission_allowed
    payload = _create_payload(
        visibility=visibility,
        members=[{"account_id": "member-1", "role": "viewer"}] if visibility == "partial_members" else [],
    )

    with patch("services.knowledge_fs.product_authorization.RBACService.CheckAccess.check") as check_access:
        response = application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    assert response.control_space_id == "control-1"
    assert len(commands.provision_intents) == 1
    check_access.assert_not_called()


def test_product_application_create_allows_model_setup_after_creation() -> None:
    application, _product, _control_plane, commands, _facade, _rbac = _application()
    commands.provision_result.model_setup_required = True

    with patch(
        "services.knowledge_fs.product_application_service.uuid.uuid5",
        return_value="operation-1",
    ):
        response = application.create_space(
            tenant_id="tenant-1",
            account_id="account-1",
            payload=_create_payload(embedding=None, retrieval=None),
        )

    intent = commands.provision_intents[-1]
    assert intent.model_intent is None
    assert intent.profile_intent is None
    assert response.model_setup_required is True


def test_product_application_create_schedules_selected_website_import() -> None:
    application, _product, _control_plane, _commands, _facade, _rbac = _application()
    payload = _create_payload(
        initial_source={
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": True, "limit": 25},
            "selection": [
                {
                    "source_url": "https://docs.dify.ai/getting-started",
                    "title": "Getting started",
                }
            ],
        }
    )

    with (
        patch(
            "services.knowledge_fs.product_application_service.uuid.uuid5",
            return_value="operation-1",
        ),
        patch("tasks.knowledge_fs_initial_source_tasks.import_initial_source.delay") as schedule_import,
    ):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    schedule_import.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        operation_id="operation-1",
        payload={
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "datasource": "crawl",
            "parameters": {},
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": True, "limit": 25},
            "selection": [
                {
                    "source_url": "https://docs.dify.ai/getting-started",
                    "canonical_url": "https://docs.dify.ai/getting-started",
                    "title": "Getting started",
                }
            ],
            "sync_policy": "daily",
        },
    )


def test_product_application_create_schedules_selected_connector_import() -> None:
    application, _product, _control_plane, _commands, _facade, _rbac = _application()
    payload = _create_payload(
        initial_source={
            "kind": "online_document",
            "name": "Product wiki",
            "pluginId": "langgenius/notion_datasource",
            "provider": "notion",
            "datasource": "pages",
            "credentialId": "credential-1",
            "selection": [
                {
                    "name": "Roadmap",
                    "pageId": "page-1",
                    "providerItemId": "notion:page-1",
                    "type": "page",
                    "workspaceId": "workspace-1",
                }
            ],
        }
    )

    with (
        patch(
            "services.knowledge_fs.product_application_service.uuid.uuid5",
            return_value="operation-1",
        ),
        patch("tasks.knowledge_fs_initial_source_tasks.import_initial_source.delay") as schedule_import,
    ):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=payload)

    scheduled_payload = schedule_import.call_args.kwargs["payload"]
    assert scheduled_payload == {
        "credential_id": "credential-1",
        "datasource": "pages",
        "kind": "online_document",
        "name": "Product wiki",
        "parameters": {},
        "plugin_id": "langgenius/notion_datasource",
        "provider": "notion",
        "selection": [
            {
                "name": "Roadmap",
                "page_id": "page-1",
                "provider_item_id": "notion:page-1",
                "type": "page",
                "workspace_id": "workspace-1",
            }
        ],
        "sync_policy": "daily",
    }


def test_product_application_create_generates_idempotency_and_skips_default_visibility_update() -> None:
    application, _product, control_plane, commands, _facade, _rbac = _application()

    with (
        patch(
            "services.knowledge_fs.product_application_service.uuid.uuid4",
            return_value="generated-idempotency",
        ),
        patch(
            "services.knowledge_fs.product_application_service.uuid.uuid5",
            return_value="operation-1",
        ),
    ):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=_create_payload())

    assert commands.provision_intents[-1].idempotency_key == "generated-idempotency"
    assert control_plane.update_visibility_calls == []


def test_product_application_update_applies_visibility_and_metadata_then_refetches() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    detail = object()
    product.space_detail = detail
    facade.update_space_results = [{"id": "space-1", "revision": 4}]
    payload = KnowledgeFSSpaceUpdatePayload(
        icon_background="#FCE7F6",
        name="Renamed",
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
    )

    result = application.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=payload,
    )

    assert result is detail
    assert len(product.authorize_control_space_calls) == 1
    assert control_plane.update_visibility_calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "control_space_id": "control-1",
            "visibility": KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
        }
    ]
    metadata = facade.update_space_payloads[-1]
    assert metadata.name == "Renamed"
    assert metadata.icon_background is None
    assert metadata.visibility is None
    assert control_plane.update_icon_background_calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "control_space_id": "control-1",
            "icon_background": "#FCE7F6",
        }
    ]
    assert control_plane.advance_knowledge_space_revision_calls == [
        {
            "tenant_id": "tenant-1",
            "control_space_id": "control-1",
            "knowledge_space_id": "space-1",
            "revision": 4,
        }
    ]


def test_product_application_updates_an_icon_background_without_remote_metadata_io() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    detail = object()
    product.space_detail = detail

    result = application.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSpaceUpdatePayload(icon_background="#D3F8DF"),
    )

    assert result is detail
    assert facade.update_space_calls == []
    assert control_plane.update_icon_background_calls == [
        {
            "tenant_id": "tenant-1",
            "actor_account_id": "account-1",
            "control_space_id": "control-1",
            "icon_background": "#D3F8DF",
        }
    ]


def test_product_application_update_recovers_one_stale_revision_conflict_then_syncs() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    stale_detail = _SpaceDetail(
        technical_summary=_TechnicalSummary(
            knowledge_space_id="space-1",
            revision=4,
        )
    )
    final_detail = object()
    product.queued_space_details = [stale_detail, final_detail]
    facade.update_space_results = [
        KnowledgeFSProductRequestRejectedError(status_code=409),
        {"id": "space-1", "revision": 5},
    ]

    result = application.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSpaceUpdatePayload(description="Recovered"),
    )

    assert result is final_detail
    assert len(facade.update_space_calls) == 2
    assert control_plane.advance_knowledge_space_revision_calls == [
        {
            "tenant_id": "tenant-1",
            "control_space_id": "control-1",
            "knowledge_space_id": "space-1",
            "revision": 4,
        },
        {
            "tenant_id": "tenant-1",
            "control_space_id": "control-1",
            "knowledge_space_id": "space-1",
            "revision": 5,
        },
    ]


def test_product_application_update_does_not_retry_non_conflict_rejection() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    facade.update_space_results = [KnowledgeFSProductRequestRejectedError(status_code=422)]

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        application.update_space(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSSpaceUpdatePayload(description="Invalid"),
        )

    assert error.value.status_code == 422
    assert len(facade.update_space_calls) == 1
    assert product.get_space_calls == []
    assert control_plane.advance_knowledge_space_revision_calls == []


def test_product_application_update_with_no_changes_only_refetches() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    product.space_detail = object()

    application.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSpaceUpdatePayload(),
    )

    assert control_plane.update_visibility_calls == []
    assert facade.update_space_calls == []
    assert len(product.get_space_calls) == 1


def test_product_application_delete_authorizes_then_emits_one_command() -> None:
    application, product, _control_plane, commands, _facade, _rbac = _application()

    with patch(
        "services.knowledge_fs.product_application_service.uuid.uuid4",
        return_value="delete-operation-1",
    ):
        application.delete_space(tenant_id="tenant-1", account_id="account-1", control_space_id="control-1")

    assert len(product.authorize_control_space_calls) == 1
    assert commands.request_deletion_calls == [
        {
            "tenant_id": "tenant-1",
            "control_space_id": "control-1",
            "operation_id": "delete-operation-1",
            "idempotency_key": "delete:delete-operation-1",
        }
    ]

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, call, patch

import pytest

from models.knowledge_fs import KnowledgeFSControlSpaceState, KnowledgeFSControlSpaceVisibility
from services.knowledge_fs.control_plane_service import KnowledgeFSControlPlaneService
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceCommandService
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_application_service import KnowledgeFSProductApplicationService
from services.knowledge_fs.product_authorization import KnowledgeFSProductRBACPort
from services.knowledge_fs.product_dto import KnowledgeFSSpaceCreatePayload, KnowledgeFSSpaceUpdatePayload
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
)
from services.knowledge_fs.product_service import KnowledgeFSProductService


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


def _application(*, allowed: bool = True):
    product = MagicMock()
    control_plane = MagicMock()
    commands = MagicMock()
    facade = MagicMock()
    rbac = MagicMock()
    rbac.workspace_permission_allowed.return_value = allowed
    commands.create_provision_intent.return_value = SimpleNamespace(
        control_space=SimpleNamespace(id="control-1", state=KnowledgeFSControlSpaceState.PROVISIONING),
        model_setup_required=False,
    )
    product.authorize_control_space.return_value = SimpleNamespace(
        control_space=SimpleNamespace(knowledge_space_id="space-1")
    )
    application = KnowledgeFSProductApplicationService(
        product=product,
        control_plane=control_plane,
        commands=commands,
        facade=facade,
        rbac=rbac,
    )
    return application, product, control_plane, commands, facade, rbac


def test_product_application_delegates_reads_without_reauthorizing() -> None:
    application, product, _control_plane, _commands, _facade, _rbac = _application()
    listed = object()
    detail = object()
    product.list_spaces.return_value = listed
    product.get_space.return_value = detail

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
    product.list_spaces.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        page=2,
        limit=25,
        creator_ids=["creator-1", "creator-2"],
        query="support",
    )
    product.get_space.assert_called_once_with(
        tenant_id="tenant-1", account_id="account-1", control_space_id="control-1"
    )


def test_product_application_create_enforces_workspace_rbac_before_command() -> None:
    application, product, _control_plane, commands, _facade, rbac = _application(allowed=False)

    with pytest.raises(PermissionError, match="creation is not allowed"):
        application.create_space(tenant_id="tenant-1", account_id="account-1", payload=_create_payload())

    product.require_product_routes.assert_called_once_with(tenant_id="tenant-1")
    rbac.workspace_permission_allowed.assert_called_once()
    commands.create_provision_intent.assert_not_called()


def test_product_application_create_preserves_model_profile_and_updates_non_private_visibility() -> None:
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
    product.require_product_routes.assert_called_once_with(tenant_id="tenant-1")
    intent = commands.create_provision_intent.call_args.args[0]
    assert intent.idempotency_key == "create-once"
    assert intent.model_intent == {"pluginId": "plugin", "provider": "provider", "model": "embedding"}
    assert intent.profile_intent["rerank"] == {
        "enabled": True,
        "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
    }
    assert intent.profile_intent["scoreThreshold"] == {
        "enabled": True,
        "stage": "mode-final",
        "value": 0.5,
    }
    control_plane.update_visibility.assert_called_once_with(
        tenant_id="tenant-1",
        actor_account_id="account-1",
        control_space_id="control-1",
        visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
    )


def test_product_application_create_allows_model_setup_after_creation() -> None:
    application, _product, _control_plane, commands, _facade, _rbac = _application()
    commands.create_provision_intent.return_value.model_setup_required = True

    with patch(
        "services.knowledge_fs.product_application_service.uuid.uuid5",
        return_value="operation-1",
    ):
        response = application.create_space(
            tenant_id="tenant-1",
            account_id="account-1",
            payload=_create_payload(embedding=None, retrieval=None),
        )

    intent = commands.create_provision_intent.call_args.args[0]
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
                    "title": "Getting started",
                }
            ],
            "sync_policy": "provider",
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
        "sync_policy": "provider",
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

    assert commands.create_provision_intent.call_args.args[0].idempotency_key == "generated-idempotency"
    control_plane.update_visibility.assert_not_called()


def test_product_application_update_applies_visibility_and_metadata_then_refetches() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    detail = object()
    product.get_space.return_value = detail
    facade.update_space.return_value = {"id": "space-1", "revision": 4}
    payload = KnowledgeFSSpaceUpdatePayload(
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
    product.authorize_control_space.assert_called_once()
    control_plane.update_visibility.assert_called_once_with(
        tenant_id="tenant-1",
        actor_account_id="account-1",
        control_space_id="control-1",
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
    )
    metadata = facade.update_space.call_args.kwargs["payload"]
    assert metadata.name == "Renamed"
    assert metadata.visibility is None
    control_plane.advance_knowledge_space_revision.assert_called_once_with(
        tenant_id="tenant-1",
        control_space_id="control-1",
        knowledge_space_id="space-1",
        revision=4,
    )


def test_product_application_update_recovers_one_stale_revision_conflict_then_syncs() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    stale_detail = SimpleNamespace(
        technical_summary=SimpleNamespace(
            knowledge_space_id="space-1",
            revision=4,
        )
    )
    final_detail = object()
    product.get_space.side_effect = [stale_detail, final_detail]
    facade.update_space.side_effect = [
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
    assert facade.update_space.call_count == 2
    assert control_plane.advance_knowledge_space_revision.call_args_list == [
        call(
            tenant_id="tenant-1",
            control_space_id="control-1",
            knowledge_space_id="space-1",
            revision=4,
        ),
        call(
            tenant_id="tenant-1",
            control_space_id="control-1",
            knowledge_space_id="space-1",
            revision=5,
        ),
    ]


def test_product_application_update_does_not_retry_non_conflict_rejection() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    facade.update_space.side_effect = KnowledgeFSProductRequestRejectedError(status_code=422)

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as error:
        application.update_space(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            payload=KnowledgeFSSpaceUpdatePayload(description="Invalid"),
        )

    assert error.value.status_code == 422
    facade.update_space.assert_called_once()
    product.get_space.assert_not_called()
    control_plane.advance_knowledge_space_revision.assert_not_called()


def test_product_application_update_with_no_changes_only_refetches() -> None:
    application, product, control_plane, _commands, facade, _rbac = _application()
    product.get_space.return_value = object()

    application.update_space(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        payload=KnowledgeFSSpaceUpdatePayload(),
    )

    control_plane.update_visibility.assert_not_called()
    facade.update_space.assert_not_called()
    product.get_space.assert_called_once()


def test_product_application_delete_authorizes_then_emits_one_command() -> None:
    application, product, _control_plane, commands, _facade, _rbac = _application()

    with patch(
        "services.knowledge_fs.product_application_service.uuid.uuid4",
        return_value="delete-operation-1",
    ):
        application.delete_space(tenant_id="tenant-1", account_id="account-1", control_space_id="control-1")

    product.authorize_control_space.assert_called_once()
    commands.request_deletion.assert_called_once_with(
        tenant_id="tenant-1",
        control_space_id="control-1",
        operation_id="delete-operation-1",
        idempotency_key="delete:delete-operation-1",
    )

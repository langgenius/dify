from collections.abc import Sequence
from unittest.mock import Mock, create_autospec

import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.rag.extractor.entity.datasource_type import NotionPageType
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.models.document import Document
from services.data_source.credential_gateway import (
    ActorDatasourceCredentialResolver,
    DatasourceCredentialError,
    DatasourceCredentialNotFoundError,
)
from services.data_source.notion_import_adapters import PluginNotionSourceGateway
from services.data_source.notion_import_application_service import NotionImportCredentialUnavailableError


def _credentials(credentials: dict[str, object], *, error: DatasourceCredentialError | None = None) -> Mock:
    resolver = create_autospec(ActorDatasourceCredentialResolver, instance=True, spec_set=True)
    resolver.resolve.return_value = credentials
    resolver.resolve.side_effect = error
    return resolver


def _runtime(messages: Sequence[OnlineDocumentPagesMessage] = ()) -> Mock:
    runtime = create_autospec(OnlineDocumentDatasourcePlugin, instance=True)
    runtime.runtime = DatasourceRuntime(tenant_id="workspace-1")
    runtime.get_online_document_pages.return_value = iter(messages)
    runtime.datasource_provider_type.return_value = DatasourceProviderType.ONLINE_DOCUMENT
    return runtime


def _page(page_id: str, *, with_icon: bool = True, page_type: str = "page") -> OnlineDocumentPage:
    return OnlineDocumentPage(
        page_id=page_id,
        page_name=f"Page {page_id}",
        page_icon={"type": "emoji", "emoji": "📄"} if with_icon else None,
        type=page_type,
        last_edited_time="2026-01-01T00:00:00Z",
        parent_id=None,
    )


def test_list_authorized_pages_groups_paginated_results_by_workspace() -> None:
    runtime = _runtime(
        messages=(
            OnlineDocumentPagesMessage(
                result=[
                    OnlineDocumentInfo(
                        workspace_id="w1",
                        workspace_name="One",
                        workspace_icon=None,
                        total=1,
                        pages=[_page("p1")],
                    )
                ]
            ),
            OnlineDocumentPagesMessage(
                result=[
                    OnlineDocumentInfo(
                        workspace_id="w2",
                        workspace_name="Two",
                        workspace_icon=None,
                        total=1,
                        pages=[_page("p2", with_icon=False)],
                    ),
                    OnlineDocumentInfo(
                        workspace_id="w1",
                        workspace_name="One",
                        workspace_icon=None,
                        total=1,
                        pages=[_page("p3")],
                    ),
                ]
            ),
        )
    )
    resolver = _credentials({"integration_secret": "secret"})
    loader = Mock(return_value=runtime)
    gateway = PluginNotionSourceGateway(credentials=resolver, runtime_loader=loader)

    workspaces = gateway.list_authorized_pages(
        workspace_id="workspace-1", actor_id="actor-1", credential_id="credential-1"
    )

    assert [workspace.workspace_id for workspace in workspaces] == ["w1", "w2"]
    assert [page.page_id for page in workspaces[0].pages] == ["p1", "p3"]
    assert [page.page_id for page in workspaces[1].pages] == ["p2"]
    assert workspaces[0].pages[0].page_icon is not None
    assert workspaces[0].pages[0].page_icon.emoji == "📄"
    assert workspaces[1].pages[0].page_icon is None
    assert runtime.runtime.credentials == {"integration_secret": "secret"}
    runtime.get_online_document_pages.assert_called_once_with(
        user_id="actor-1",
        datasource_parameters={},
        provider_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )
    resolver.resolve.assert_called_once_with(
        workspace_id="workspace-1",
        actor_id="actor-1",
        credential_id="credential-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )
    loader.assert_called_once_with(
        provider_id="langgenius/notion_datasource/notion_datasource",
        datasource_name="notion_datasource",
        tenant_id="workspace-1",
        datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )


def test_list_authorized_pages_skips_unknown_page_types() -> None:
    runtime = _runtime(
        messages=(
            OnlineDocumentPagesMessage(
                result=[
                    OnlineDocumentInfo(
                        workspace_id="w1",
                        workspace_name="One",
                        workspace_icon=None,
                        total=2,
                        pages=[_page("known"), _page("unknown", page_type="collection")],
                    )
                ]
            ),
        )
    )
    gateway = PluginNotionSourceGateway(
        credentials=_credentials({"integration_secret": "secret"}),
        runtime_loader=Mock(return_value=runtime),
    )

    workspaces = gateway.list_authorized_pages(
        workspace_id="workspace-1", actor_id="actor-1", credential_id="credential-1"
    )

    assert [page.page_id for page in workspaces[0].pages] == ["known"]


def test_preview_requires_secret_and_passes_it_only_to_extractor() -> None:
    factory = create_autospec(NotionExtractor, spec_set=True)
    factory.return_value.extract.return_value = [Document(page_content="one"), Document(page_content="two")]
    gateway = PluginNotionSourceGateway(
        credentials=_credentials({"integration_secret": "secret"}),
        runtime_loader=Mock(),
        extractor_factory=factory,
    )

    content = gateway.preview_page(
        workspace_id="workspace-1",
        actor_id="actor-1",
        credential_id="credential-1",
        page_id="page-1",
        page_type=NotionPageType.PAGE,
    )

    assert content == "one\ntwo"
    extractor_args = factory.call_args.kwargs
    assert extractor_args["notion_obj_id"] == "page-1"
    assert extractor_args["notion_page_type"] == "page"
    assert extractor_args["notion_access_token"] == "secret"
    assert extractor_args["tenant_id"] == "workspace-1"


def test_preview_fails_closed_when_secret_is_missing() -> None:
    gateway = PluginNotionSourceGateway(
        credentials=_credentials({}),
        runtime_loader=Mock(),
    )

    with pytest.raises(NotionImportCredentialUnavailableError):
        gateway.preview_page(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
            page_id="page-1",
            page_type=NotionPageType.PAGE,
        )


def test_gateway_translates_credential_infrastructure_failure() -> None:
    gateway = PluginNotionSourceGateway(
        credentials=_credentials({}, error=DatasourceCredentialNotFoundError()),
        runtime_loader=Mock(),
    )

    with pytest.raises(NotionImportCredentialUnavailableError):
        gateway.list_authorized_pages(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
        )

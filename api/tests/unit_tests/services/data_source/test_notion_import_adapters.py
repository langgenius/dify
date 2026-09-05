from collections.abc import Generator
from dataclasses import dataclass, field

import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
)
from core.rag.extractor.entity.datasource_type import NotionPageType
from core.rag.models.document import Document
from services.data_source.credential_gateway import DatasourceCredentialError, DatasourceCredentialNotFoundError
from services.data_source.notion_import_adapters import PluginNotionSourceGateway
from services.data_source.notion_import_application_service import NotionImportCredentialUnavailableError


@dataclass
class RecordingCredentialResolver:
    credentials: dict[str, object]
    error: DatasourceCredentialError | None = None
    calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        self.calls.append((workspace_id, actor_id, credential_id, provider, plugin_id))
        if self.error is not None:
            raise self.error
        return self.credentials


@dataclass
class RecordingDatasourceRuntime:
    messages: tuple[OnlineDocumentPagesMessage, ...]
    runtime: DatasourceRuntime = field(default_factory=lambda: DatasourceRuntime(tenant_id="workspace-1"))
    users: list[str] = field(default_factory=list)

    def get_online_document_pages(
        self, user_id: str, datasource_parameters: dict[str, object], provider_type: str
    ) -> Generator[OnlineDocumentPagesMessage, None, None]:
        assert datasource_parameters == {}
        assert provider_type == DatasourceProviderType.ONLINE_DOCUMENT
        self.users.append(user_id)
        yield from self.messages

    def datasource_provider_type(self) -> str:
        return DatasourceProviderType.ONLINE_DOCUMENT


@dataclass
class StaticRuntimeLoader:
    runtime: RecordingDatasourceRuntime
    calls: list[tuple[str, str, str, DatasourceProviderType]] = field(default_factory=list)

    def __call__(
        self,
        *,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> object:
        self.calls.append((provider_id, datasource_name, tenant_id, datasource_type))
        return self.runtime


@dataclass
class StaticExtractor:
    documents: list[Document]

    def extract(self) -> list[Document]:
        return self.documents


@dataclass
class RecordingExtractorFactory:
    calls: list[dict[str, object]] = field(default_factory=list)

    def __call__(self, **kwargs: object) -> StaticExtractor:
        self.calls.append(kwargs)
        return StaticExtractor([Document(page_content="one"), Document(page_content="two")])


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
    runtime = RecordingDatasourceRuntime(
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
    resolver = RecordingCredentialResolver({"integration_secret": "secret"})
    loader = StaticRuntimeLoader(runtime)
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
    assert runtime.users == ["actor-1"]
    assert resolver.calls == [
        (
            "workspace-1",
            "actor-1",
            "credential-1",
            "notion_datasource",
            "langgenius/notion_datasource",
        )
    ]


def test_list_authorized_pages_skips_unknown_page_types() -> None:
    runtime = RecordingDatasourceRuntime(
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
        credentials=RecordingCredentialResolver({"integration_secret": "secret"}),
        runtime_loader=StaticRuntimeLoader(runtime),
    )

    workspaces = gateway.list_authorized_pages(
        workspace_id="workspace-1", actor_id="actor-1", credential_id="credential-1"
    )

    assert [page.page_id for page in workspaces[0].pages] == ["known"]


def test_preview_requires_secret_and_passes_it_only_to_extractor() -> None:
    factory = RecordingExtractorFactory()
    gateway = PluginNotionSourceGateway(
        credentials=RecordingCredentialResolver({"integration_secret": "secret"}),
        runtime_loader=StaticRuntimeLoader(RecordingDatasourceRuntime(())),
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
    extractor_args = factory.calls[0]
    assert extractor_args["notion_obj_id"] == "page-1"
    assert extractor_args["notion_page_type"] == "page"
    assert extractor_args["notion_access_token"] == "secret"
    assert extractor_args["tenant_id"] == "workspace-1"


def test_preview_fails_closed_when_secret_is_missing() -> None:
    gateway = PluginNotionSourceGateway(
        credentials=RecordingCredentialResolver({}),
        runtime_loader=StaticRuntimeLoader(RecordingDatasourceRuntime(())),
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
        credentials=RecordingCredentialResolver({}, error=DatasourceCredentialNotFoundError()),
        runtime_loader=StaticRuntimeLoader(RecordingDatasourceRuntime(())),
    )

    with pytest.raises(NotionImportCredentialUnavailableError):
        gateway.list_authorized_pages(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
        )

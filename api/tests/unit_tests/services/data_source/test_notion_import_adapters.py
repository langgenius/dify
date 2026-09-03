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
from core.rag.models.document import Document
from services.data_source.notion_import_adapters import NotionCredentialDataError, PluginNotionSourceGateway


@dataclass
class RecordingCredentialResolver:
    credentials: dict[str, object]
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

    def __call__(
        self,
        notion_workspace_id: str,
        notion_obj_id: str,
        notion_page_type: str,
        tenant_id: str,
        document_model: object | None = None,
        notion_access_token: str | None = None,
        credential_id: str | None = None,
    ) -> StaticExtractor:
        self.calls.append(
            {
                "notion_workspace_id": notion_workspace_id,
                "notion_obj_id": notion_obj_id,
                "notion_page_type": notion_page_type,
                "tenant_id": tenant_id,
                "document_model": document_model,
                "notion_access_token": notion_access_token,
                "credential_id": credential_id,
            }
        )
        return StaticExtractor([Document(page_content="one"), Document(page_content="two")])


def _page(page_id: str, *, with_icon: bool = True) -> OnlineDocumentPage:
    return OnlineDocumentPage(
        page_id=page_id,
        page_name=f"Page {page_id}",
        page_icon={"type": "emoji", "emoji": "📄"} if with_icon else None,
        type="page",
        last_edited_time="2026-01-01T00:00:00Z",
        parent_id=None,
    )


def test_list_authorized_pages_preserves_and_merges_workspace_groups() -> None:
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
        page_type="page",
    )

    assert content == "one\ntwo"
    assert factory.calls[0]["notion_access_token"] == "secret"


def test_preview_fails_closed_when_secret_is_missing() -> None:
    gateway = PluginNotionSourceGateway(
        credentials=RecordingCredentialResolver({}),
        runtime_loader=StaticRuntimeLoader(RecordingDatasourceRuntime(())),
    )

    with pytest.raises(NotionCredentialDataError):
        gateway.preview_page(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
            page_id="page-1",
            page_type="page",
        )

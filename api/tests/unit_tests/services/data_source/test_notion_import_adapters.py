from collections.abc import Callable, Generator, Sequence

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDocumentInfo,
    OnlineDocumentPage,
    OnlineDocumentPagesMessage,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.entities.provider_entities import ProviderConfig, ProviderConfigType
from core.helper import encrypter
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import PluginDatasourceManager
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.models.document import Document
from extensions.application_services.data_sources import build_data_source_credentials
from models.enums import PermissionEnum
from models.oauth import DatasourceProvider
from services.data_source.credential_gateway import (
    ActorAwareDatasourceCredentialGateway,
    DatasourceCredentialNotFoundError,
)
from services.data_source.entities.notion_import import NotionPageType
from services.data_source.notion_import_adapters import PluginNotionSourceGateway
from services.data_source.notion_import_application_service import NotionImportCredentialUnavailableError
from tests.unit_tests.core.datasource.factories import datasource_entity, provider_entity

type CredentialCalls = list[tuple[str, str, str, str, str]]


@pytest.fixture
def credential_resolver(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls]:
    """Run the real resolver, repository and codec; isolate plugin and key-store I/O."""
    declaration = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
    declaration.credentials_schema = [ProviderConfig(type=ProviderConfigType.SECRET_INPUT, name="integration_secret")]
    plugin_provider = PluginDatasourceProviderEntity(
        provider="notion_datasource",
        plugin_unique_identifier="langgenius/notion_datasource:1.0.0",
        plugin_id="langgenius/notion_datasource",
        declaration=declaration,
    )

    def fetch_provider(
        self: PluginDatasourceManager, tenant_id: str, provider_id: str
    ) -> PluginDatasourceProviderEntity:
        del self
        assert tenant_id == "workspace-1"
        assert provider_id == "langgenius/notion_datasource/notion_datasource"
        return plugin_provider

    def decrypt_token(tenant_id: str, token: str) -> str:
        assert (tenant_id, token) == ("workspace-1", "encrypted-secret")
        return "secret"

    monkeypatch.setattr(PluginDatasourceManager, "fetch_datasource_provider", fetch_provider)
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt_token)
    resolver = build_data_source_credentials(database_client=sqlite_session_factory).actor
    resolve = resolver.resolve
    calls: CredentialCalls = []

    def resolve_and_record(
        *, workspace_id: str, actor_id: str, credential_id: str, provider: str, plugin_id: str
    ) -> dict[str, object]:
        calls.append((workspace_id, actor_id, credential_id, provider, plugin_id))
        return resolve(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )

    monkeypatch.setattr(resolver, "resolve", resolve_and_record)
    return resolver, calls


def _store_credentials(session_factory: sessionmaker[Session], credentials: dict[str, object]) -> None:
    record = DatasourceProvider(
        tenant_id="workspace-1",
        user_id="actor-1",
        name="Notion",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
        auth_type="api-key",
        encrypted_credentials=credentials,
        visibility=PermissionEnum.ONLY_ME,
    )
    record.id = "credential-1"
    with session_factory.begin() as session:
        session.add(record)


def _runtime(
    monkeypatch: pytest.MonkeyPatch,
    messages: Sequence[OnlineDocumentPagesMessage] = (),
) -> tuple[OnlineDocumentDatasourcePlugin, list[tuple[str, dict[str, object], str]]]:
    runtime = OnlineDocumentDatasourcePlugin(
        entity=datasource_entity("notion_datasource"),
        runtime=DatasourceRuntime(tenant_id="workspace-1"),
        tenant_id="workspace-1",
        icon="icon.svg",
        plugin_unique_identifier="langgenius/notion_datasource",
    )
    calls: list[tuple[str, dict[str, object], str]] = []

    def get_online_document_pages(
        user_id: str,
        datasource_parameters: dict[str, object],
        provider_type: str,
    ) -> Generator[OnlineDocumentPagesMessage]:
        calls.append((user_id, datasource_parameters, provider_type))
        yield from messages

    monkeypatch.setattr(runtime, "get_online_document_pages", get_online_document_pages)
    return runtime, calls


def _runtime_loader(runtime: OnlineDocumentDatasourcePlugin) -> Callable[..., object]:
    def load_runtime(
        *,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> object:
        del provider_id, datasource_name, tenant_id, datasource_type
        return runtime

    return load_runtime


def _unexpected_runtime_loader(
    *,
    provider_id: str,
    datasource_name: str,
    tenant_id: str,
    datasource_type: DatasourceProviderType,
) -> object:
    del provider_id, datasource_name, tenant_id, datasource_type
    raise AssertionError("runtime loader should not be called")


def _page(page_id: str, *, with_icon: bool = True, page_type: str = "page") -> OnlineDocumentPage:
    return OnlineDocumentPage(
        page_id=page_id,
        page_name=f"Page {page_id}",
        page_icon={"type": "emoji", "emoji": "📄"} if with_icon else None,
        type=page_type,
        last_edited_time="2026-01-01T00:00:00Z",
        parent_id=None,
    )


def test_list_authorized_pages_groups_paginated_results_by_workspace(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    credential_resolver: tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls],
) -> None:
    runtime, runtime_calls = _runtime(
        monkeypatch,
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
        ),
    )
    _store_credentials(sqlite_session_factory, {"integration_secret": "encrypted-secret"})
    resolver, credential_calls = credential_resolver
    loader_calls: list[tuple[str, str, str, DatasourceProviderType]] = []

    def loader(
        *,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> object:
        loader_calls.append((provider_id, datasource_name, tenant_id, datasource_type))
        return runtime

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
    assert runtime_calls == [("actor-1", {}, DatasourceProviderType.ONLINE_DOCUMENT)]
    assert credential_calls == [
        ("workspace-1", "actor-1", "credential-1", "notion_datasource", "langgenius/notion_datasource")
    ]
    assert loader_calls == [
        (
            "langgenius/notion_datasource/notion_datasource",
            "notion_datasource",
            "workspace-1",
            DatasourceProviderType.ONLINE_DOCUMENT,
        )
    ]


def test_list_authorized_pages_skips_unknown_page_types(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    credential_resolver: tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls],
) -> None:
    _store_credentials(sqlite_session_factory, {"integration_secret": "encrypted-secret"})
    runtime, _ = _runtime(
        monkeypatch,
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
        ),
    )
    gateway = PluginNotionSourceGateway(
        credentials=credential_resolver[0],
        runtime_loader=_runtime_loader(runtime),
    )

    workspaces = gateway.list_authorized_pages(
        workspace_id="workspace-1", actor_id="actor-1", credential_id="credential-1"
    )

    assert [page.page_id for page in workspaces[0].pages] == ["known"]


def test_preview_requires_secret_and_passes_it_only_to_extractor(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    credential_resolver: tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls],
) -> None:
    _store_credentials(sqlite_session_factory, {"integration_secret": "encrypted-secret"})
    extractor_calls: list[NotionExtractor] = []
    factory_calls: list[tuple[str, str, str, str, Callable[[], str], str]] = []

    def extract(extractor: NotionExtractor) -> list[Document]:
        extractor_calls.append(extractor)
        return [Document(page_content="one"), Document(page_content="two")]

    def extractor_factory(
        *,
        notion_workspace_id: str,
        notion_obj_id: str,
        notion_page_type: str,
        notion_access_token: str,
        notion_token_loader: Callable[[], str],
        tenant_id: str,
    ) -> NotionExtractor:
        factory_calls.append(
            (
                notion_workspace_id,
                notion_obj_id,
                notion_page_type,
                notion_access_token,
                notion_token_loader,
                tenant_id,
            )
        )
        return NotionExtractor(
            notion_workspace_id=notion_workspace_id,
            notion_obj_id=notion_obj_id,
            notion_page_type=notion_page_type,
            notion_access_token=notion_access_token,
            notion_token_loader=notion_token_loader,
            tenant_id=tenant_id,
        )

    monkeypatch.setattr(NotionExtractor, "extract", extract)
    gateway = PluginNotionSourceGateway(
        credentials=credential_resolver[0],
        runtime_loader=_unexpected_runtime_loader,
        extractor_factory=extractor_factory,
    )

    content = gateway.preview_page(
        workspace_id="workspace-1",
        actor_id="actor-1",
        credential_id="credential-1",
        page_id="page-1",
        page_type=NotionPageType.PAGE,
    )

    assert content == "one\ntwo"
    assert len(extractor_calls) == 1
    assert type(extractor_calls[0]) is NotionExtractor
    assert len(factory_calls) == 1
    workspace_id, object_id, page_type, access_token, token_loader, tenant_id = factory_calls[0]
    assert workspace_id == ""
    assert object_id == "page-1"
    assert page_type == "page"
    assert access_token == "secret"
    assert token_loader() == "secret"
    assert tenant_id == "workspace-1"


def test_preview_fails_closed_when_secret_is_missing(
    sqlite_session_factory: sessionmaker[Session],
    credential_resolver: tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls],
) -> None:
    _store_credentials(sqlite_session_factory, {})
    gateway = PluginNotionSourceGateway(
        credentials=credential_resolver[0],
        runtime_loader=_unexpected_runtime_loader,
    )

    with pytest.raises(NotionImportCredentialUnavailableError):
        gateway.preview_page(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
            page_id="page-1",
            page_type=NotionPageType.PAGE,
        )


def test_gateway_translates_credential_infrastructure_failure(
    credential_resolver: tuple[ActorAwareDatasourceCredentialGateway, CredentialCalls],
) -> None:
    gateway = PluginNotionSourceGateway(
        credentials=credential_resolver[0],
        runtime_loader=_unexpected_runtime_loader,
    )

    with pytest.raises(NotionImportCredentialUnavailableError) as error:
        gateway.list_authorized_pages(
            workspace_id="workspace-1",
            actor_id="actor-1",
            credential_id="credential-1",
        )
    assert isinstance(error.value.__cause__, DatasourceCredentialNotFoundError)

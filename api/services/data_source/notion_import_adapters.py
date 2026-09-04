"""Notion plugin and extractor adapter for import use cases."""

from collections.abc import Callable, Mapping
from typing import Protocol, cast

from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.models.document import Document as ExtractedDocument
from services.entities.data_source.notion_import import (
    AuthorizedNotionPage,
    NotionWorkspace,
    notion_page_icon,
)

_NOTION_PROVIDER = "notion_datasource"
_NOTION_PLUGIN = "langgenius/notion_datasource"
_NOTION_RUNTIME_PROVIDER = f"{_NOTION_PLUGIN}/{_NOTION_PROVIDER}"


class _CredentialResolver(Protocol):
    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]: ...


class _RuntimeLoader(Protocol):
    def __call__(
        self,
        *,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> object: ...


class _NotionPageExtractor(Protocol):
    def extract(self) -> list[ExtractedDocument]: ...


class NotionSourceAdapterError(Exception):
    """Base class for Notion adapter failures."""


class NotionCredentialDataError(NotionSourceAdapterError):
    def __init__(self) -> None:
        super().__init__("Notion credential does not contain an integration secret")


class PluginNotionSourceGateway:
    def __init__(
        self,
        *,
        credentials: _CredentialResolver,
        runtime_loader: _RuntimeLoader | None = None,
        extractor_factory: Callable[..., _NotionPageExtractor] = NotionExtractor,
    ) -> None:
        if runtime_loader is None:
            from core.datasource.datasource_manager import DatasourceManager

            runtime_loader = DatasourceManager.get_datasource_runtime
        self._credentials = credentials
        self._runtime_loader = runtime_loader
        self._extractor_factory = extractor_factory

    def list_authorized_pages(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
    ) -> tuple[NotionWorkspace, ...]:
        credentials = self._resolve_credentials(workspace_id, actor_id, credential_id)
        runtime = cast(
            OnlineDocumentDatasourcePlugin,
            self._runtime_loader(
                provider_id=_NOTION_RUNTIME_PROVIDER,
                datasource_name=_NOTION_PROVIDER,
                tenant_id=workspace_id,
                datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
            ),
        )
        runtime.runtime.credentials = dict(credentials)

        grouped: dict[tuple[str | None, str | None, str | None], list[AuthorizedNotionPage]] = {}
        for message in runtime.get_online_document_pages(
            user_id=actor_id,
            datasource_parameters={},
            provider_type=runtime.datasource_provider_type(),
        ):
            for workspace in message.result:
                key = (workspace.workspace_id, workspace.workspace_name, workspace.workspace_icon)
                pages = grouped.setdefault(key, [])
                pages.extend(
                    AuthorizedNotionPage(
                        page_id=page.page_id,
                        page_name=page.page_name,
                        page_icon=notion_page_icon(page.page_icon),
                        parent_id=page.parent_id,
                        page_type=page.type,
                    )
                    for page in workspace.pages
                )
        return tuple(
            NotionWorkspace(
                workspace_id=key[0],
                workspace_name=key[1],
                workspace_icon=key[2],
                pages=tuple(pages),
            )
            for key, pages in grouped.items()
        )

    def preview_page(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        page_id: str,
        page_type: str,
    ) -> str:
        credentials = self._resolve_credentials(workspace_id, actor_id, credential_id)
        integration_secret = credentials.get("integration_secret")
        if not isinstance(integration_secret, str) or not integration_secret:
            raise NotionCredentialDataError()
        extractor = self._extractor_factory(
            notion_workspace_id="",
            notion_obj_id=page_id,
            notion_page_type=page_type,
            notion_access_token=integration_secret,
            tenant_id=workspace_id,
        )
        return "\n".join(document.page_content for document in extractor.extract())

    def _resolve_credentials(
        self,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
    ) -> Mapping[str, object]:
        return self._credentials.resolve(
            workspace_id=workspace_id,
            actor_id=actor_id,
            credential_id=credential_id,
            provider=_NOTION_PROVIDER,
            plugin_id=_NOTION_PLUGIN,
        )

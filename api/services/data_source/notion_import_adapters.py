"""Notion plugin and extractor adapter for import use cases."""

import logging
from collections.abc import Callable, Mapping
from typing import Protocol, cast

from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.rag.extractor.entity.datasource_type import NotionPageType
from core.rag.extractor.notion_extractor import NotionExtractor
from core.rag.models.document import Document as ExtractedDocument
from services.data_source.credential_gateway import ActorDatasourceCredentialResolver, DatasourceCredentialError
from services.data_source.notion_import_application_service import NotionImportCredentialUnavailableError
from services.entities.data_source.notion_import import (
    AuthorizedNotionPage,
    NotionWorkspace,
    notion_page_icon,
)

_NOTION_PROVIDER = "notion_datasource"
_NOTION_PLUGIN = "langgenius/notion_datasource"
_NOTION_RUNTIME_PROVIDER = f"{_NOTION_PLUGIN}/{_NOTION_PROVIDER}"
logger = logging.getLogger(__name__)


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


class PluginNotionSourceGateway:
    def __init__(
        self,
        *,
        credentials: ActorDatasourceCredentialResolver,
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

        workspaces: dict[str | None, tuple[str | None, str | None, list[AuthorizedNotionPage]]] = {}
        for message in runtime.get_online_document_pages(
            user_id=actor_id,
            datasource_parameters={},
            provider_type=runtime.datasource_provider_type(),
        ):
            for workspace in message.result:
                workspace_info = workspaces.get(workspace.workspace_id)
                if workspace_info is None:
                    workspace_info = (workspace.workspace_name, workspace.workspace_icon, [])
                    workspaces[workspace.workspace_id] = workspace_info
                for page in workspace.pages:
                    try:
                        page_type = NotionPageType(page.type)
                    except (TypeError, ValueError):
                        logger.warning("Skipping unsupported Notion page type %r for page %s", page.type, page.page_id)
                        continue
                    workspace_info[2].append(
                        AuthorizedNotionPage(
                            page_id=page.page_id,
                            page_name=page.page_name,
                            page_icon=notion_page_icon(page.page_icon),
                            parent_id=page.parent_id,
                            page_type=page_type,
                        )
                    )
        return tuple(
            NotionWorkspace(
                workspace_id=workspace_id,
                workspace_name=workspace_name,
                workspace_icon=workspace_icon,
                pages=tuple(pages),
            )
            for workspace_id, (workspace_name, workspace_icon, pages) in workspaces.items()
        )

    def preview_page(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        page_id: str,
        page_type: NotionPageType,
    ) -> str:
        credentials = self._resolve_credentials(workspace_id, actor_id, credential_id)
        integration_secret = credentials.get("integration_secret")
        if not isinstance(integration_secret, str) or not integration_secret:
            raise NotionImportCredentialUnavailableError()
        extractor = self._extractor_factory(
            notion_workspace_id="",
            notion_obj_id=page_id,
            notion_page_type=page_type.value,
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
        try:
            return self._credentials.resolve(
                workspace_id=workspace_id,
                actor_id=actor_id,
                credential_id=credential_id,
                provider=_NOTION_PROVIDER,
                plugin_id=_NOTION_PLUGIN,
            )
        except DatasourceCredentialError as error:
            raise NotionImportCredentialUnavailableError() from error

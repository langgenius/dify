"""Datasource backward invocation through Dify's tenant-bound runtime.

This module is the internal service boundary used by trusted callers such as
KnowledgeFS. It resolves installed provider declarations and Dify-owned
credential references before reaching ``PluginDatasourceManager``; callers
must never provide raw datasource credentials or a plugin-daemon API key.
"""

from collections.abc import Generator
from typing import Any, cast

from pydantic import BaseModel

from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import (
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.plugin.entities.request import RequestInvokeDatasource
from models.account import Tenant
from models.provider_ids import DatasourceProviderID
from services.datasource_provider_service import DatasourceProviderService


class PluginDatasourceBackwardsInvocation(BaseBackwardsInvocation):
    """Resolve and invoke a datasource without exposing credential material to the caller."""

    @classmethod
    def invoke(
        cls,
        *,
        user_id: str,
        tenant: Tenant,
        payload: RequestInvokeDatasource,
    ) -> Generator[BaseModel | dict[str, Any], None, None]:
        """Yield datasource messages for one validated inner-runtime request."""
        provider_id = DatasourceProviderID(payload.provider)
        canonical_provider_id = str(provider_id)
        controller = DatasourceManager.get_datasource_plugin_provider(
            provider_id=canonical_provider_id,
            tenant_id=tenant.id,
            datasource_type=payload.datasource_type,
        )
        if controller.entity.provider_type != payload.datasource_type:
            raise ValueError("Datasource provider type mismatch")

        # Resolving the datasource from the installed declaration prevents a caller
        # from dispatching an arbitrary datasource name under a valid plugin ID.
        runtime = controller.get_datasource(payload.datasource)
        credentials = DatasourceProviderService().get_datasource_credentials(
            tenant_id=tenant.id,
            provider=provider_id.provider_name,
            plugin_id=provider_id.plugin_id,
            credential_id=payload.credential_id,
        )
        if controller.need_credentials and not credentials:
            raise ValueError("Datasource credential not found")

        if payload.operation == "validate_credentials":
            controller.validate_credentials(user_id=user_id, credentials=credentials)
            yield {"result": True}
            return

        runtime.runtime.credentials = credentials
        provider_type = runtime.datasource_provider_type()

        match payload.operation:
            case "get_website_crawl":
                website = cast(WebsiteCrawlDatasourcePlugin, runtime)
                yield from website.get_website_crawl(
                    user_id=user_id,
                    datasource_parameters=payload.datasource_parameters,
                    provider_type=provider_type,
                )
            case "get_online_document_pages":
                document = cast(OnlineDocumentDatasourcePlugin, runtime)
                yield from document.get_online_document_pages(
                    user_id=user_id,
                    datasource_parameters=payload.datasource_parameters,
                    provider_type=provider_type,
                )
            case "get_online_document_page_content":
                if payload.page is None:
                    raise ValueError("Online-document page input is required")
                document = cast(OnlineDocumentDatasourcePlugin, runtime)
                yield from document.get_online_document_page_content(
                    user_id=user_id,
                    datasource_parameters=payload.page,
                    provider_type=provider_type,
                )
            case "online_drive_browse_files":
                drive = cast(OnlineDriveDatasourcePlugin, runtime)
                yield from drive.online_drive_browse_files(
                    user_id=user_id,
                    request=OnlineDriveBrowseFilesRequest.model_validate(payload.request),
                    provider_type=provider_type,
                )
            case "online_drive_download_file":
                drive = cast(OnlineDriveDatasourcePlugin, runtime)
                yield from drive.online_drive_download_file(
                    user_id=user_id,
                    request=OnlineDriveDownloadFileRequest.model_validate(payload.request),
                    provider_type=provider_type,
                )
            case _:
                raise ValueError(f"Unsupported datasource operation: {payload.operation}")

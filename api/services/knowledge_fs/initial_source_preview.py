"""Read-only datasource discovery used before a KnowledgeFS Space exists."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, cast

from sqlalchemy import select

from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from models.account import Account
from models.credential_permission import CredentialType
from models.oauth import DatasourceProvider
from services.credential_permission_service import CredentialPermissionService
from services.datasource_provider_service import DatasourceProviderService
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialSourcePreviewDocumentResponse,
    KnowledgeFSInitialSourcePreviewFileResponse,
    KnowledgeFSInitialSourcePreviewPageResponse,
    KnowledgeFSInitialSourcePreviewPayload,
    KnowledgeFSInitialSourcePreviewResponse,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
)

_MAX_PREVIEW_ITEMS = 200


class KnowledgeFSInitialSourcePreviewCanceledError(RuntimeError):
    pass


def _raise_if_canceled(is_canceled: Callable[[], bool] | None) -> None:
    if is_canceled is not None and is_canceled():
        raise KnowledgeFSInitialSourcePreviewCanceledError("Datasource preview was canceled")


class KnowledgeFSInitialSourcePreviewService:
    def __init__(self, session_maker) -> None:
        self._session_maker = session_maker

    def require_visible_credential(
        self,
        *,
        tenant_id: str,
        account: Account,
        payload: KnowledgeFSInitialSourcePreviewPayload | KnowledgeFSInitialWebsiteSourcePreviewPayload,
    ) -> None:
        query = select(DatasourceProvider).where(
            DatasourceProvider.tenant_id == tenant_id,
            DatasourceProvider.id == payload.credential_id,
            DatasourceProvider.provider == payload.provider,
            DatasourceProvider.plugin_id == payload.plugin_id,
        )
        query = CredentialPermissionService.apply_visibility_filter(
            query,
            model_id_column=DatasourceProvider.id,
            model_user_id_column=DatasourceProvider.user_id,
            model_visibility_column=DatasourceProvider.visibility,
            credential_type=CredentialType.DATASOURCE_PROVIDER,
            user=account,
        )
        with self._session_maker() as session:
            if session.scalar(query.limit(1)) is None:
                raise PermissionError("Datasource credential is unavailable")

    def preview(
        self,
        *,
        tenant_id: str,
        account: Account,
        payload: KnowledgeFSInitialSourcePreviewPayload | KnowledgeFSInitialWebsiteSourcePreviewPayload,
        is_canceled: Callable[[], bool] | None = None,
    ) -> KnowledgeFSInitialSourcePreviewResponse:
        _raise_if_canceled(is_canceled)
        self.require_visible_credential(tenant_id=tenant_id, account=account, payload=payload)
        credentials = DatasourceProviderService().get_datasource_credentials(
            tenant_id=tenant_id,
            provider=payload.provider,
            plugin_id=payload.plugin_id,
            credential_id=payload.credential_id,
            current_user=account,
        )
        if not credentials:
            raise PermissionError("Datasource credential is unavailable")
        provider_type = DatasourceProviderType(payload.kind)
        runtime = DatasourceManager.get_datasource_runtime(
            provider_id=f"{payload.plugin_id}/{payload.provider}",
            datasource_name=payload.datasource,
            tenant_id=tenant_id,
            datasource_type=provider_type,
        )
        runtime.runtime.credentials = credentials
        parameters = dict(payload.parameters)
        if payload.kind == "website_crawl":
            website_runtime = cast(WebsiteCrawlDatasourcePlugin, runtime)
            pages_by_url: dict[str, KnowledgeFSInitialSourcePreviewPageResponse] = {}
            for website_message in website_runtime.get_website_crawl(
                user_id=account.id,
                datasource_parameters=parameters,
                provider_type=website_runtime.datasource_provider_type(),
            ):
                _raise_if_canceled(is_canceled)
                for website_page in website_message.result.web_info_list or []:
                    pages_by_url[website_page.source_url] = KnowledgeFSInitialSourcePreviewPageResponse(
                        content=website_page.content,
                        description=website_page.description or None,
                        source_url=website_page.source_url,
                        title=website_page.title or None,
                    )
                    if len(pages_by_url) >= _MAX_PREVIEW_ITEMS:
                        return KnowledgeFSInitialSourcePreviewResponse(
                            kind=payload.kind,
                            pages=list(pages_by_url.values()),
                        )
            return KnowledgeFSInitialSourcePreviewResponse(
                kind=payload.kind,
                pages=list(pages_by_url.values()),
            )
        if payload.kind == "online_document":
            document_runtime = cast(OnlineDocumentDatasourcePlugin, runtime)
            documents: list[KnowledgeFSInitialSourcePreviewDocumentResponse] = []
            for document_message in document_runtime.get_online_document_pages(
                user_id=account.id,
                datasource_parameters=parameters,
                provider_type=document_runtime.datasource_provider_type(),
            ):
                for workspace in document_message.result:
                    workspace_id = workspace.workspace_id or payload.provider
                    for document_page in workspace.pages:
                        documents.append(
                            KnowledgeFSInitialSourcePreviewDocumentResponse(
                                last_edited_time=document_page.last_edited_time,
                                name=document_page.page_name,
                                page_id=document_page.page_id,
                                provider_item_id=json.dumps(
                                    [workspace_id, document_page.page_id], separators=(",", ":")
                                ),
                                type=document_page.type,
                                workspace_id=workspace_id,
                                workspace_name=workspace.workspace_name,
                            )
                        )
                        if len(documents) >= _MAX_PREVIEW_ITEMS:
                            return KnowledgeFSInitialSourcePreviewResponse(
                                documents=documents,
                                kind=payload.kind,
                            )
            return KnowledgeFSInitialSourcePreviewResponse(documents=documents, kind=payload.kind)

        drive_runtime = cast(OnlineDriveDatasourcePlugin, runtime)
        files: list[KnowledgeFSInitialSourcePreviewFileResponse] = []
        next_page_parameters = None
        max_keys = parameters.get("max_keys", _MAX_PREVIEW_ITEMS)
        if not isinstance(max_keys, int) or isinstance(max_keys, bool):
            max_keys = _MAX_PREVIEW_ITEMS
        max_keys = min(max(max_keys, 1), _MAX_PREVIEW_ITEMS)
        bucket = parameters.get("bucket")
        prefix = parameters.get("prefix")
        raw_next_page_parameters = parameters.get("next_page_parameters")
        request = OnlineDriveBrowseFilesRequest(
            bucket=bucket if isinstance(bucket, str) else None,
            prefix=prefix if isinstance(prefix, str) else "",
            max_keys=max_keys,
            next_page_parameters=(
                cast(dict[str, Any], raw_next_page_parameters) if isinstance(raw_next_page_parameters, dict) else None
            ),
        )
        for drive_message in drive_runtime.online_drive_browse_files(
            user_id=account.id,
            request=request,
            provider_type=drive_runtime.datasource_provider_type(),
        ):
            for group in drive_message.result:
                if group.is_truncated and group.next_page_parameters:
                    next_page_parameters = group.next_page_parameters
                if group.bucket and not group.files:
                    files.append(
                        KnowledgeFSInitialSourcePreviewFileResponse(
                            bucket=group.bucket,
                            id="",
                            name=group.bucket,
                            provider_item_id=json.dumps([group.bucket, ""], separators=(",", ":")),
                            size=0,
                            type="bucket",
                        )
                    )
                for file in group.files:
                    files.append(
                        KnowledgeFSInitialSourcePreviewFileResponse(
                            bucket=group.bucket,
                            id=file.id,
                            mime_type=file.type if "/" in file.type else None,
                            name=file.name,
                            provider_item_id=json.dumps([group.bucket or "", file.id], separators=(",", ":")),
                            size=file.size,
                            type=file.type,
                        )
                    )
                    if len(files) >= _MAX_PREVIEW_ITEMS:
                        return KnowledgeFSInitialSourcePreviewResponse(
                            files=files,
                            kind=payload.kind,
                            next_page_parameters=next_page_parameters,
                        )
        return KnowledgeFSInitialSourcePreviewResponse(
            files=files,
            kind=payload.kind,
            next_page_parameters=next_page_parameters,
        )


__all__ = ["KnowledgeFSInitialSourcePreviewCanceledError", "KnowledgeFSInitialSourcePreviewService"]

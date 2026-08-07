"""Durable follow-up that starts the first website import after Space provisioning."""

from __future__ import annotations

import logging

from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.knowledge_fs import KnowledgeFSControlSpaceState
from models.oauth import DatasourceProvider
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSInitialWebsiteSourcePayload,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

_FIRECRAWL_PROVIDER_ID = "plugin-daemon-website"
_FIRECRAWL_PLUGIN_ID = "langgenius/firecrawl_datasource"
_PAGE_SIZE = 200

logger = logging.getLogger(__name__)


class KnowledgeFSInitialSourceNotReadyError(RuntimeError):
    """The Space or Source workflow is still progressing and should be retried."""

    def __init__(self, message: str, *, workflow_id: str | None = None) -> None:
        super().__init__(message)
        self.workflow_id = workflow_id


def _find_initial_source(*, facade, tenant_id: str, account_id: str, control_space_id: str, request_id: str):
    cursor: str | None = None
    while True:
        response = facade.list_sources(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            cursor=cursor,
            limit=_PAGE_SIZE,
        )
        for source in response.data:
            if source.metadata.get("clientRequestId") == request_id:
                return source
        if not response.next_cursor:
            return None
        cursor = response.next_cursor


def _find_firecrawl_credential(*, session_maker, tenant_id: str) -> tuple[str, str]:
    with session_maker() as session:
        credential = session.scalar(
            select(DatasourceProvider)
            .where(
                DatasourceProvider.tenant_id == tenant_id,
                DatasourceProvider.provider == "firecrawl",
                DatasourceProvider.plugin_id == _FIRECRAWL_PLUGIN_ID,
            )
            .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
            .limit(1)
        )
    if credential is None:
        raise RuntimeError("Firecrawl credential is unavailable")
    return str(credential.id), credential.name or "Firecrawl"


def _find_or_create_firecrawl_connection(
    *,
    facade,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    credential_id: str,
    credential_name: str,
):
    providers = facade.list_source_providers(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
    )
    if not any(provider.id == _FIRECRAWL_PROVIDER_ID and provider.available for provider in providers.data):
        raise RuntimeError("Firecrawl provider is unavailable")

    cursor: str | None = None
    while True:
        response = facade.list_source_connections(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            cursor=cursor,
            limit=_PAGE_SIZE,
        )
        for connection in response.data:
            if (
                connection.provider_id != _FIRECRAWL_PROVIDER_ID
                or connection.configuration.get("credentialId") != credential_id
            ):
                continue
            if connection.status == "active":
                return connection
            if connection.status == "provisioning":
                raise KnowledgeFSInitialSourceNotReadyError("Firecrawl connection is still provisioning")
            raise RuntimeError(f"Firecrawl connection is unavailable in state {connection.status}")
        if not response.next_cursor:
            break
        cursor = response.next_cursor

    connection = facade.create_source_connection(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        payload=KnowledgeFSSourceConnectionCreatePayload(
            authKind="endpoint",
            configuration={
                "credentialId": credential_id,
                "datasource": "crawl",
                "pluginId": _FIRECRAWL_PLUGIN_ID,
                "provider": "firecrawl",
                "providerKind": "website",
            },
            credentials={},
            name=credential_name,
            providerId=_FIRECRAWL_PROVIDER_ID,
        ),
    )
    if connection.status != "active":
        raise KnowledgeFSInitialSourceNotReadyError("Firecrawl connection is still provisioning")
    return connection


def start_initial_website_source_import(
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: KnowledgeFSInitialWebsiteSourcePayload,
    workflow_id: str | None = None,
) -> str:
    """Idempotently create the provisional Source and start its selected crawl import."""

    session_maker = session_factory.get_session_maker()
    with session_maker() as session:
        control_space = SQLAlchemyKnowledgeFSControlSpaceRepository(session).get(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
        )
        if control_space is None:
            raise RuntimeError("KnowledgeFS control-space was not found")
        if control_space.state is not KnowledgeFSControlSpaceState.ACTIVE or control_space.knowledge_space_id is None:
            if control_space.state is KnowledgeFSControlSpaceState.PROVISIONING:
                raise KnowledgeFSInitialSourceNotReadyError("KnowledgeFS Space is still provisioning")
            raise RuntimeError(
                f"KnowledgeFS Space cannot accept an initial Source in state {control_space.state.value}"
            )

    facade = get_knowledge_fs_runtime(session_maker).facade
    if workflow_id is not None:
        workflow = facade.get_source_workflow(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            run_id=workflow_id,
        )
        if workflow.source_id is None:
            raise RuntimeError("Initial website Source import workflow has no Source")
        source_id = workflow.source_id
    else:
        request_id = f"initial-website-source:{operation_id}"
        source = _find_initial_source(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            request_id=request_id,
        )
        if source is None:
            credential_id, credential_name = _find_firecrawl_credential(
                session_maker=session_maker,
                tenant_id=tenant_id,
            )
            connection = _find_or_create_firecrawl_connection(
                facade=facade,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                credential_id=credential_id,
                credential_name=credential_name,
            )
            source = facade.create_source(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                payload=KnowledgeFSSourceCreatePayload(
                    connectionId=connection.id,
                    metadata={
                        "clientRequestId": request_id,
                        "crawlOptions": {
                            "includeSubpages": payload.crawl_options.include_subpages,
                            "limit": payload.crawl_options.limit,
                        },
                        "preview": True,
                        "providerId": _FIRECRAWL_PROVIDER_ID,
                    },
                    name=payload.name,
                    status="disabled",
                    type="web",
                    uri=payload.root_url,
                ),
            )
        source_id = source.id
        workflow = facade.import_selected_source_crawl(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSCrawlImportPayload(
                sourceUrls=[selection.source_url for selection in payload.selection],
            ),
            idempotency_key=f"{request_id}:crawl-import",
        )

    if workflow.state in {"queued", "running", "crawling", "importing", "syncing"}:
        raise KnowledgeFSInitialSourceNotReadyError(
            "Initial website Source import is still running",
            workflow_id=workflow.id,
        )
    if workflow.state != "completed":
        failed_source = facade.get_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        initial_import = {
            "errorCode": workflow.last_error_code,
            "errorMessage": workflow.last_error_message,
            "state": workflow.state,
            "workflowId": workflow.id,
        }
        if (
            failed_source.metadata.get("preview") is not False
            or failed_source.metadata.get("initialImport") != initial_import
            or failed_source.status != "disabled"
        ):
            facade.update_source(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                source_id=source_id,
                payload=KnowledgeFSSourceUpdatePayload(
                    expectedVersion=failed_source.version,
                    metadata={
                        **failed_source.metadata,
                        "initialImport": initial_import,
                        "preview": False,
                    },
                    status="disabled",
                ),
            )
        logger.error(
            "Initial website Source import failed",
            extra={
                "control_space_id": control_space_id,
                "error_code": workflow.last_error_code,
                "error_message": workflow.last_error_message,
                "source_id": source_id,
                "workflow_id": workflow.id,
                "workflow_state": workflow.state,
            },
        )
        return workflow.id

    imported_source = facade.get_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
    )
    if imported_source.status == "active" and imported_source.metadata.get("preview") is False:
        committed_source = imported_source
    else:
        committed_source = facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSSourceUpdatePayload(
                expectedVersion=imported_source.version,
                metadata={**imported_source.metadata, "preview": False},
                status="active",
            ),
        )
    try:
        current_policy = facade.get_source_sync_policy(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        expected_revision = current_policy.revision
    except KnowledgeFSProductResourceNotFoundError:
        expected_revision = 0
    if payload.sync_policy == "manual":
        sync_policy = KnowledgeFSSourceSyncPolicyPayload(
            enabled=False,
            mode="manual",
            expectedRevision=expected_revision,
            expectedSourceVersion=committed_source.version,
        )
    elif payload.sync_policy == "daily":
        sync_policy = KnowledgeFSSourceSyncPolicyPayload(
            enabled=True,
            mode="interval",
            expectedRevision=expected_revision,
            expectedSourceVersion=committed_source.version,
        )
    else:
        sync_policy = KnowledgeFSSourceSyncPolicyPayload(
            enabled=True,
            mode="provider",
            expectedRevision=expected_revision,
            expectedSourceVersion=committed_source.version,
        )
    facade.update_source_sync_policy(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        payload=sync_policy,
    )
    return workflow.id


@shared_task(
    bind=True,
    queue="knowledge_fs_lifecycle",
    max_retries=180,
    default_retry_delay=2,
)
def import_initial_website_source(
    self,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None = None,
) -> str:
    try:
        return start_initial_website_source_import(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            payload=KnowledgeFSInitialWebsiteSourcePayload.model_validate(payload),
            workflow_id=workflow_id,
        )
    except KnowledgeFSInitialSourceNotReadyError as exc:
        if exc.workflow_id is not None:
            raise self.retry(
                exc=exc,
                kwargs={
                    "tenant_id": tenant_id,
                    "account_id": account_id,
                    "control_space_id": control_space_id,
                    "operation_id": operation_id,
                    "payload": payload,
                    "workflow_id": exc.workflow_id,
                },
            )
        raise self.retry(exc=exc)


__all__ = ["import_initial_website_source", "start_initial_website_source_import"]

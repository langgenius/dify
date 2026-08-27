"""Durable follow-up that imports the first Source after Space provisioning."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from celery import shared_task
from pydantic import TypeAdapter
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.account import Account
from models.credential_permission import CredentialType
from models.knowledge_fs import KnowledgeFSControlSpaceState
from models.oauth import DatasourceProvider
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from services.credential_permission_service import CredentialPermissionService
from services.knowledge_fs.product_dto import (
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSInitialOnlineDocumentSourcePayload,
    KnowledgeFSInitialSourcePayload,
    KnowledgeFSInitialWebsiteSourcePayload,
    KnowledgeFSOnlineDocumentWorkflowImportPayload,
    KnowledgeFSOnlineDriveWorkflowImportPayload,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowImportPayload,
    knowledge_fs_initial_preview_configuration_fingerprint,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRemoteError, KnowledgeFSProductResourceNotFoundError
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

_LEGACY_WEBSITE_PLUGIN_IDS = {
    "firecrawl": "langgenius/firecrawl_datasource",
    "jinareader": "langgenius/jina_datasource",
    "watercrawl": "watercrawl/watercrawl_datasource",
}
_PAGE_SIZE = 200
_INITIAL_SOURCE_ADAPTER: TypeAdapter[KnowledgeFSInitialSourcePayload] = TypeAdapter(KnowledgeFSInitialSourcePayload)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _DatasourceBinding:
    credential_id: str | None
    datasource: str
    plugin_id: str
    provider: str
    provider_id: str
    provider_kind: str


@dataclass(frozen=True)
class KnowledgeFSInitialSourceSubmission:
    """Source creation result; the first import is deliberately best-effort."""

    connection_id: str
    source_id: str
    workflow_id: str | None
    workflow_error: str | None = None


class KnowledgeFSInitialSourceNotReadyError(RuntimeError):
    """The Space, connection, or Source workflow is progressing and should be retried."""

    def __init__(self, message: str, *, workflow_id: str | None = None) -> None:
        super().__init__(message)
        self.workflow_id = workflow_id


def _binding(payload: KnowledgeFSInitialSourcePayload) -> _DatasourceBinding:
    if isinstance(payload, KnowledgeFSInitialWebsiteSourcePayload):
        normalized_provider = "".join(character for character in payload.provider.lower() if character.isalnum())
        plugin_id = payload.plugin_id or _LEGACY_WEBSITE_PLUGIN_IDS.get(normalized_provider)
        if plugin_id is None:
            raise RuntimeError("Website datasource plugin binding is required")
        return _DatasourceBinding(
            credential_id=payload.credential_id,
            datasource=payload.datasource,
            plugin_id=plugin_id,
            provider=payload.provider,
            provider_id="plugin-daemon-website",
            provider_kind="website",
        )
    if isinstance(payload, KnowledgeFSInitialOnlineDocumentSourcePayload):
        return _DatasourceBinding(
            credential_id=payload.credential_id,
            datasource=payload.datasource,
            plugin_id=payload.plugin_id,
            provider=payload.provider,
            provider_id="plugin-daemon-online-document",
            provider_kind="online-document",
        )
    return _DatasourceBinding(
        credential_id=payload.credential_id,
        datasource=payload.datasource,
        plugin_id=payload.plugin_id,
        provider=payload.provider,
        provider_id="plugin-daemon-online-drive",
        provider_kind="online-drive",
    )


def _request_id(*, operation_id: str, payload: KnowledgeFSInitialSourcePayload) -> str:
    # Preserve the original website request ID so retries from the previous rollout
    # reconcile with the same provisional Source.
    if isinstance(payload, KnowledgeFSInitialWebsiteSourcePayload):
        return f"initial-website-source:{operation_id}"
    return f"initial-source:{operation_id}"


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


def _find_credential(*, session_maker, tenant_id: str, account_id: str, binding: _DatasourceBinding) -> tuple[str, str]:
    query = select(DatasourceProvider).where(
        DatasourceProvider.tenant_id == tenant_id,
        DatasourceProvider.provider == binding.provider,
        DatasourceProvider.plugin_id == binding.plugin_id,
    )
    with session_maker() as session:
        account = session.get(Account, account_id)
        if account is None:
            raise RuntimeError("Initial Source account was not found")
        query = CredentialPermissionService.apply_visibility_filter(
            query,
            model_id_column=DatasourceProvider.id,
            model_user_id_column=DatasourceProvider.user_id,
            model_visibility_column=DatasourceProvider.visibility,
            credential_type=CredentialType.DATASOURCE_PROVIDER,
            user=account,
        )
        if binding.credential_id is not None:
            query = query.where(DatasourceProvider.id == binding.credential_id)
        credential = session.scalar(
            query.order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc()).limit(1)
        )
    if credential is None:
        raise RuntimeError("Datasource credential is unavailable")
    return str(credential.id), credential.name or binding.provider


def _find_or_create_connection(
    *,
    facade,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    binding: _DatasourceBinding,
    credential_id: str,
    credential_name: str,
):
    providers = facade.list_source_providers(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
    )
    if not any(provider.id == binding.provider_id and provider.available for provider in providers.data):
        raise RuntimeError(f"{binding.provider_kind} provider is unavailable")

    expected_configuration: dict[str, bool | int | str] = {
        "credentialId": credential_id,
        "datasource": binding.datasource,
        "pluginId": binding.plugin_id,
        "provider": binding.provider,
        "providerKind": binding.provider_kind,
    }
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
            if connection.provider_id != binding.provider_id:
                continue
            if any(connection.configuration.get(key) != value for key, value in expected_configuration.items()):
                continue
            if connection.status == "active":
                return connection
            if connection.status == "provisioning":
                raise KnowledgeFSInitialSourceNotReadyError("Datasource connection is still provisioning")
            raise RuntimeError(f"Datasource connection is unavailable in state {connection.status}")
        if not response.next_cursor:
            break
        cursor = response.next_cursor

    connection = facade.create_source_connection(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        payload=KnowledgeFSSourceConnectionCreatePayload(
            authKind="endpoint",
            configuration=expected_configuration,
            credentials={},
            name=credential_name,
            providerId=binding.provider_id,
        ),
    )
    if connection.status != "active":
        raise KnowledgeFSInitialSourceNotReadyError("Datasource connection is still provisioning")
    return connection


def _source_payload(
    *,
    payload: KnowledgeFSInitialSourcePayload,
    binding: _DatasourceBinding,
    connection_id: str,
    request_id: str,
) -> KnowledgeFSSourceCreatePayload:
    metadata: dict[str, object] = {
        "clientRequestId": request_id,
        "preview": True,
        "providerId": binding.provider_id,
        "providerKind": binding.provider_kind,
        "providerName": payload.provider_display_name or payload.provider,
    }
    if "parameters" in payload.model_fields_set:
        metadata["datasourceParameterMode"] = "exact"
        metadata["parameters"] = dict(payload.parameters)
    if isinstance(payload, KnowledgeFSInitialWebsiteSourcePayload):
        metadata["crawlOptions"] = {
            "includeSubpages": payload.crawl_options.include_subpages,
            "limit": payload.crawl_options.limit,
        }
        metadata["initialPreview"] = {
            "configurationFingerprint": knowledge_fs_initial_preview_configuration_fingerprint(payload),
            "requestedSourceUrls": [selection.source_url for selection in payload.selection],
            "canonicalSourceUrls": [selection.canonical_url for selection in payload.selection],
        }
        source_type: Literal["connector", "web"] = "web"
        uri = payload.root_url
    else:
        source_type = "connector"
        uri = f"connector://{connection_id}"
    return KnowledgeFSSourceCreatePayload(
        connectionId=connection_id,
        metadata=metadata,
        name=payload.name,
        status="disabled",
        type=source_type,
        uri=uri,
    )


def _start_workflow(
    *,
    facade,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    source_id: str,
    request_id: str,
    payload: KnowledgeFSInitialSourcePayload,
):
    if isinstance(payload, KnowledgeFSInitialWebsiteSourcePayload):
        return facade.import_selected_source_crawl(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSCrawlImportPayload(
                sourceUrls=[selection.canonical_url or selection.source_url for selection in payload.selection],
            ),
            idempotency_key=f"{request_id}:crawl-import",
        )
    if isinstance(payload, KnowledgeFSInitialOnlineDocumentSourcePayload):
        import_payload = KnowledgeFSSourceWorkflowImportPayload(
            KnowledgeFSOnlineDocumentWorkflowImportPayload(
                kind="online-document-import",
                items=payload.selection,
            )
        )
    else:
        import_payload = KnowledgeFSSourceWorkflowImportPayload(
            KnowledgeFSOnlineDriveWorkflowImportPayload(
                kind="online-drive-import",
                items=payload.selection,
            )
        )
    return facade.import_source_workflow(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        payload=import_payload,
        idempotency_key=f"{request_id}:connector-import",
    )


def _sync_policy_payload(
    *, payload: KnowledgeFSInitialSourcePayload, expected_revision: int, source_version: int
) -> KnowledgeFSSourceSyncPolicyPayload:
    if payload.sync_policy == "manual":
        return KnowledgeFSSourceSyncPolicyPayload(
            enabled=False,
            mode="manual",
            expectedRevision=expected_revision,
            expectedSourceVersion=source_version,
        )
    if payload.sync_policy == "daily":
        return KnowledgeFSSourceSyncPolicyPayload(
            enabled=True,
            mode="interval",
            expectedRevision=expected_revision,
            expectedSourceVersion=source_version,
        )
    if payload.sync_policy == "custom":
        return KnowledgeFSSourceSyncPolicyPayload(
            customIntervalSeconds=payload.custom_interval_seconds,
            enabled=True,
            mode="custom",
            expectedRevision=expected_revision,
            expectedSourceVersion=source_version,
        )
    return KnowledgeFSSourceSyncPolicyPayload(
        enabled=True,
        mode="provider",
        expectedRevision=expected_revision,
        expectedSourceVersion=source_version,
    )


def start_initial_source_import(
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: KnowledgeFSInitialSourcePayload,
    workflow_id: str | None = None,
) -> str:
    """Idempotently create a provisional Source, import its selection, and commit it."""

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
            raise RuntimeError("Initial Source import workflow has no Source")
        source_id = workflow.source_id
    else:
        request_id = _request_id(operation_id=operation_id, payload=payload)
        source = _find_initial_source(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            request_id=request_id,
        )
        if source is None:
            binding = _binding(payload)
            credential_id, credential_name = _find_credential(
                session_maker=session_maker,
                tenant_id=tenant_id,
                account_id=account_id,
                binding=binding,
            )
            connection = _find_or_create_connection(
                facade=facade,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                binding=binding,
                credential_id=credential_id,
                credential_name=credential_name,
            )
            source = facade.create_source(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                payload=_source_payload(
                    payload=payload,
                    binding=binding,
                    connection_id=connection.id,
                    request_id=request_id,
                ),
            )
        source_id = source.id
        workflow = _start_workflow(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            request_id=request_id,
            payload=payload,
        )

    if workflow.state in {"queued", "running", "crawling", "importing", "syncing"}:
        raise KnowledgeFSInitialSourceNotReadyError(
            "Initial Source import is still running",
            workflow_id=workflow.id,
        )
    if workflow.state != "completed":
        failed_source = facade.get_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        error_message = workflow.failure.message if workflow.failure is not None else None
        initial_import: dict[str, object] = {
            "errorCode": workflow.last_error_code,
            "errorMessage": error_message,
            "state": workflow.state,
            "workflowId": workflow.id,
        }
        if isinstance(payload, KnowledgeFSInitialWebsiteSourcePayload):
            initial_import.update(
                {
                    "configurationFingerprint": knowledge_fs_initial_preview_configuration_fingerprint(payload),
                    "requestedSourceUrls": [selection.source_url for selection in payload.selection],
                    "canonicalSourceUrls": [selection.canonical_url for selection in payload.selection],
                }
            )
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
                        "initialImport": initial_import,
                        "preview": False,
                    },
                    status="disabled",
                ),
            )
        logger.error(
            "Initial Source import failed",
            extra={
                "control_space_id": control_space_id,
                "error_code": workflow.last_error_code,
                "error_message": error_message,
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
                metadata={"preview": False},
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
    facade.update_source_sync_policy(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        payload=_sync_policy_payload(
            payload=payload,
            expected_revision=expected_revision,
            source_version=committed_source.version,
        ),
    )
    return workflow.id


def submit_initial_source_for_upgrade(
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: KnowledgeFSInitialSourcePayload,
) -> KnowledgeFSInitialSourceSubmission:
    """Create and commit one Source without waiting for its import workflow.

    Upgrade success is based on the independently usable Source existing. The
    selected import is submitted when possible, but a failure is returned as a
    warning because users can retry it from the new KnowledgeFS task surface.
    """

    session_maker = session_factory.get_session_maker()
    with session_maker() as session:
        control_space = SQLAlchemyKnowledgeFSControlSpaceRepository(session).get(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
        )
        if control_space is None:
            raise RuntimeError("KnowledgeFS control-space was not found")
        if control_space.state is KnowledgeFSControlSpaceState.PROVISIONING:
            raise KnowledgeFSInitialSourceNotReadyError("KnowledgeFS Space is still provisioning")
        if control_space.state is not KnowledgeFSControlSpaceState.ACTIVE or control_space.knowledge_space_id is None:
            raise RuntimeError(f"KnowledgeFS Space cannot accept a Source in state {control_space.state.value}")

    facade = get_knowledge_fs_runtime(session_maker).facade
    request_id = _request_id(operation_id=operation_id, payload=payload)
    source = _find_initial_source(
        facade=facade,
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        request_id=request_id,
    )
    if source is None:
        binding = _binding(payload)
        credential_id, credential_name = _find_credential(
            session_maker=session_maker,
            tenant_id=tenant_id,
            account_id=account_id,
            binding=binding,
        )
        connection = _find_or_create_connection(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            binding=binding,
            credential_id=credential_id,
            credential_name=credential_name,
        )
        source = facade.create_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            payload=_source_payload(
                payload=payload,
                binding=binding,
                connection_id=connection.id,
                request_id=request_id,
            ),
        )
    elif source.connection_id is None:
        raise RuntimeError("Initial Source has no connection")

    if source.status != "active" or source.metadata.get("preview") is not False:
        source = facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source.id,
            payload=KnowledgeFSSourceUpdatePayload(
                expectedVersion=source.version,
                metadata={"preview": False, "upgradeJobId": operation_id},
                status="active",
            ),
        )

    try:
        current_policy = facade.get_source_sync_policy(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source.id,
        )
        expected_revision = current_policy.revision
    except KnowledgeFSProductResourceNotFoundError:
        expected_revision = 0
    facade.update_source_sync_policy(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source.id,
        payload=_sync_policy_payload(
            payload=payload,
            expected_revision=expected_revision,
            source_version=source.version,
        ),
    )

    workflow_id: str | None = None
    workflow_error: str | None = None
    try:
        workflow = _start_workflow(
            facade=facade,
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source.id,
            request_id=request_id,
            payload=payload,
        )
        workflow_id = workflow.id
    except Exception as exc:
        workflow_error = type(exc).__name__
        logger.warning(
            "KnowledgeFS upgrade Source was created but its first import was not submitted",
            extra={
                "control_space_id": control_space_id,
                "error_code": workflow_error,
                "source_id": source.id,
            },
        )
    return KnowledgeFSInitialSourceSubmission(
        connection_id=source.connection_id or "",
        source_id=source.id,
        workflow_id=workflow_id,
        workflow_error=workflow_error,
    )


def start_initial_website_source_import(
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: KnowledgeFSInitialWebsiteSourcePayload,
    workflow_id: str | None = None,
) -> str:
    """Compatibility wrapper for callers using the original website-only protocol."""

    return start_initial_source_import(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        operation_id=operation_id,
        payload=payload,
        workflow_id=workflow_id,
    )


def _run_initial_source_task(
    task,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None,
) -> str:
    try:
        return start_initial_source_import(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            payload=_INITIAL_SOURCE_ADAPTER.validate_python(payload),
            workflow_id=workflow_id,
        )
    except KnowledgeFSInitialSourceNotReadyError as exc:
        if exc.workflow_id is not None:
            raise task.retry(
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
        raise task.retry(exc=exc)
    except KnowledgeFSProductResourceNotFoundError:
        raise
    except KnowledgeFSProductRemoteError as exc:
        raise task.retry(exc=exc)


@shared_task(bind=True, queue="knowledge_fs_lifecycle", max_retries=180, default_retry_delay=2)
def import_initial_source(
    self,
    *,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    operation_id: str,
    payload: dict[str, object],
    workflow_id: str | None = None,
) -> str:
    return _run_initial_source_task(
        self,
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        operation_id=operation_id,
        payload=payload,
        workflow_id=workflow_id,
    )


@shared_task(bind=True, queue="knowledge_fs_lifecycle", max_retries=180, default_retry_delay=2)
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
    """Compatibility task for already-enqueued website-only messages."""

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
    except KnowledgeFSProductResourceNotFoundError:
        raise
    except KnowledgeFSProductRemoteError as exc:
        raise self.retry(exc=exc)


__all__ = [
    "KnowledgeFSInitialSourceSubmission",
    "import_initial_source",
    "import_initial_website_source",
    "start_initial_source_import",
    "start_initial_website_source_import",
    "submit_initial_source_for_upgrade",
]

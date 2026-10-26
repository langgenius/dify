from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from core.db.session_factory import session_factory
from models.account import Account
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from models.oauth import DatasourceProvider
from services.knowledge_fs.initial_source_import import (
    KnowledgeFSInitialSourceNotReadyError,
    start_initial_source_import,
    start_initial_website_source_import,
    submit_initial_source_for_upgrade,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSInitialOnlineDocumentSourcePayload,
    KnowledgeFSInitialOnlineDriveSourcePayload,
    KnowledgeFSInitialWebsiteSourcePayload,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowImportPayload,
    knowledge_fs_initial_preview_configuration_fingerprint,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from tests.helpers.unit.tasks.knowledge_fs_task_fakes import (
    FacadeRuntime,
    RecordingKnowledgeFSFacade,
    json_object,
    source_connection_list_response,
    source_connection_response,
    source_list_response,
    source_provider_list_response,
    source_response,
    source_workflow_response,
    sync_policy_response,
)


def _knowledge_fs_initial_source_import_payload(sync_policy: str = "daily") -> KnowledgeFSInitialWebsiteSourcePayload:
    return KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        {
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "providerDisplayName": "Firecrawl",
            "parameters": {"url": "https://docs.dify.ai", "limit": 25},
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": True, "limit": 25},
            "selection": [
                {"source_url": "https://docs.dify.ai/a", "title": "A"},
                {"source_url": "https://docs.dify.ai/b", "title": "B"},
            ],
            **({"custom_interval_seconds": 129_600} if sync_policy == "custom" else {}),
            "sync_policy": sync_policy,
        }
    )


def _legacy_payload() -> KnowledgeFSInitialWebsiteSourcePayload:
    return KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        {
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "providerDisplayName": "Firecrawl",
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": False, "limit": 25},
            "selection": [{"source_url": "https://docs.dify.ai/a", "title": "A"}],
            "sync_policy": "manual",
        }
    )


def _document_payload() -> KnowledgeFSInitialOnlineDocumentSourcePayload:
    return KnowledgeFSInitialOnlineDocumentSourcePayload.model_validate(
        {
            "kind": "online_document",
            "name": "Product wiki",
            "pluginId": "langgenius/notion_datasource",
            "provider": "notion",
            "providerDisplayName": "Notion",
            "datasource": "pages",
            "credentialId": "notion-credential-1",
            "selection": [
                {
                    "lastEditedTime": "2026-08-10T00:00:00Z",
                    "name": "Roadmap",
                    "pageId": "page-1",
                    "providerItemId": "notion:page-1",
                    "type": "page",
                    "workspaceId": "workspace-1",
                }
            ],
        }
    )


def _drive_payload() -> KnowledgeFSInitialOnlineDriveSourcePayload:
    return KnowledgeFSInitialOnlineDriveSourcePayload.model_validate(
        {
            "kind": "online_drive",
            "name": "Team drive",
            "pluginId": "langgenius/google_drive",
            "provider": "google_drive",
            "providerDisplayName": "Google Drive",
            "datasource": "google_drive",
            "credentialId": "drive-credential-1",
            "selection": [
                {
                    "id": "file-1",
                    "mimeType": "application/pdf",
                    "name": "Plan.pdf",
                    "providerItemId": "google-drive:file-1",
                }
            ],
            "sync_policy": "manual",
        }
    )


_FIRECRAWL_CONNECTION_CONFIGURATION: dict[str, bool | int | str] = {
    "credentialId": "firecrawl-credential-1",
    "datasource": "crawl",
    "pluginId": "langgenius/firecrawl_datasource",
    "provider": "firecrawl",
    "providerKind": "website",
}


@dataclass(frozen=True)
class _Credential:
    id: str
    name: str
    provider: str = "firecrawl"
    plugin_id: str = "langgenius/firecrawl_datasource"


_FIRECRAWL_CREDENTIAL = _Credential(id="firecrawl-credential-1", name="Firecrawl")


@dataclass
class _ControlSpaceRepository:
    control_space: KnowledgeFSControlSpace | None
    lookups: list[dict[str, str]] = field(default_factory=list)

    def get(self, *, tenant_id: str, control_space_id: str) -> KnowledgeFSControlSpace | None:
        self.lookups.append({"tenant_id": tenant_id, "control_space_id": control_space_id})
        return self.control_space


def _facade() -> RecordingKnowledgeFSFacade:
    facade = RecordingKnowledgeFSFacade()
    facade.script("list_sources", source_list_response())
    facade.script("list_source_providers", source_provider_list_response("plugin-daemon-website"))
    facade.script(
        "list_source_connections",
        source_connection_list_response(
            source_connection_response(
                configuration=_FIRECRAWL_CONNECTION_CONFIGURATION,
                connection_id="connection-1",
                provider_id="plugin-daemon-website",
                status="active",
            )
        ),
    )
    facade.script(
        "create_source_connection",
        source_connection_response(
            configuration={"credentialId": "firecrawl-credential-1"},
            connection_id="connection-created",
            provider_id="plugin-daemon-website",
            status="active",
        ),
    )
    facade.script("create_source", source_response(metadata={}, status="disabled", version=1))
    facade.script(
        "import_selected_source_crawl",
        source_workflow_response(workflow_id="workflow-1", source_id="source-1", state="completed"),
    )
    facade.script(
        "get_source_workflow",
        source_workflow_response(workflow_id="workflow-1", source_id="source-1", state="completed"),
    )
    facade.script(
        "get_source",
        source_response(
            metadata={
                "clientRequestId": "initial-website-source:operation-1",
                "parameters": {"limit": 99},
                "preview": True,
            },
            status="disabled",
            version=3,
        ),
    )
    facade.script(
        "update_source",
        source_response(
            metadata={
                "clientRequestId": "initial-website-source:operation-1",
                "preview": False,
            },
            status="active",
            version=4,
        ),
    )
    facade.script("get_source_sync_policy", KnowledgeFSProductResourceNotFoundError("not found"))
    facade.script("update_source_sync_policy", None)
    return facade


def _seed_account_and_credential(credential: _Credential | None) -> None:
    account = Account(name="Initial source owner", email="initial-source-owner@example.com")
    account.id = "account-1"
    with session_factory.create_session() as session:
        session.add(account)
        if credential is not None:
            provider = DatasourceProvider(
                tenant_id="tenant-1",
                name=credential.name,
                provider=credential.provider,
                plugin_id=credential.plugin_id,
                auth_type="api_key",
                encrypted_credentials={},
            )
            provider.id = credential.id
            session.add(provider)
        session.commit()


@contextmanager
def _runtime(
    facade: RecordingKnowledgeFSFacade,
    *,
    credential: _Credential | None = _FIRECRAWL_CREDENTIAL,
    state: KnowledgeFSControlSpaceState = KnowledgeFSControlSpaceState.ACTIVE,
    knowledge_space_id: str | None = "space-1",
    control_space_found: bool = True,
) -> Generator[_ControlSpaceRepository]:
    _seed_account_and_credential(credential)
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        state=state,
        knowledge_space_id=knowledge_space_id,
    )
    repository = _ControlSpaceRepository(control_space if control_space_found else None)
    with (
        patch(
            "services.knowledge_fs.initial_source_import.SQLAlchemyKnowledgeFSControlSpaceRepository",
            return_value=repository,
        ),
        patch(
            "services.knowledge_fs.initial_source_import.get_knowledge_fs_runtime",
            return_value=FacadeRuntime(facade),
        ),
    ):
        yield repository


def _start(
    facade: RecordingKnowledgeFSFacade,
    payload: KnowledgeFSInitialWebsiteSourcePayload,
    *,
    workflow_id: str | None = None,
) -> str:
    with _runtime(facade):
        return start_initial_website_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=payload,
            workflow_id=workflow_id,
        )


def test_initial_website_source_import_recrawls_exact_selection_and_configures_daily_sync() -> None:
    facade = _facade()

    assert _start(facade, _knowledge_fs_initial_source_import_payload()) == "workflow-1"

    source_payload = facade.payload("create_source", KnowledgeFSSourceCreatePayload)
    assert source_payload.status == "disabled"
    assert source_payload.connection_id == "connection-1"
    assert source_payload.metadata["datasourceParameterMode"] == "exact"
    assert source_payload.metadata["preview"] is True
    assert source_payload.metadata["credentialId"] == "firecrawl-credential-1"
    assert source_payload.metadata["datasource"] == "crawl"
    assert source_payload.metadata["pluginId"] == "langgenius/firecrawl_datasource"
    assert source_payload.metadata["provider"] == "firecrawl"
    assert source_payload.metadata["parameters"] == {
        "limit": 25,
        "url": "https://docs.dify.ai",
    }
    import_payload = facade.payload("import_selected_source_crawl", KnowledgeFSCrawlImportPayload)
    assert import_payload.source_urls == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/b",
    ]
    source_update_payload = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    source_update_metadata = json_object(source_update_payload.metadata)
    assert source_update_payload.expected_version == 3
    assert source_update_metadata == {"preview": False}
    assert source_update_payload.status == "active"
    sync_payload = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert sync_payload.mode == "interval"
    assert sync_payload.enabled is True
    assert sync_payload.expected_revision == 0
    assert sync_payload.expected_source_version == 4


def test_initial_website_source_import_preserves_distinct_urls_with_the_same_canonical_identity() -> None:
    facade = _facade()
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        {
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "parameters": {"limit": 2, "url": "https://docs.dify.ai"},
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": True, "limit": 2},
            "selection": [
                {"source_url": "https://docs.dify.ai/a/"},
                {"source_url": "https://DOCS.dify.ai:443/a#section"},
            ],
        }
    )

    assert _start(facade, payload) == "workflow-1"

    import_payload = facade.payload("import_selected_source_crawl", KnowledgeFSCrawlImportPayload)
    assert import_payload.source_urls == [
        "https://docs.dify.ai/a/",
        "https://DOCS.dify.ai:443/a#section",
    ]


def test_initial_website_source_import_preserves_legacy_crawl_option_projection() -> None:
    facade = _facade()

    assert _start(facade, _legacy_payload()) == "workflow-1"

    source_payload = facade.payload("create_source", KnowledgeFSSourceCreatePayload)
    assert "datasourceParameterMode" not in source_payload.metadata
    assert "parameters" not in source_payload.metadata
    assert source_payload.metadata["crawlOptions"] == {
        "includeSubpages": False,
        "limit": 25,
    }
    assert source_payload.uri == "https://docs.dify.ai"


@pytest.mark.parametrize(
    (
        "payload",
        "provider_id",
        "credential_id",
        "workflow_kind",
        "expected_source_name",
        "expected_provider_name",
    ),
    [
        (
            _document_payload(),
            "plugin-daemon-online-document",
            "notion-credential-1",
            "online-document-import",
            "Product wiki",
            "Notion",
        ),
        (
            _drive_payload(),
            "plugin-daemon-online-drive",
            "drive-credential-1",
            "online-drive-import",
            "Team drive",
            "Google Drive",
        ),
    ],
)
def test_initial_connector_source_import_uses_exact_binding_and_selection(
    payload: KnowledgeFSInitialOnlineDocumentSourcePayload | KnowledgeFSInitialOnlineDriveSourcePayload,
    provider_id: str,
    credential_id: str,
    workflow_kind: str,
    expected_source_name: str,
    expected_provider_name: str,
) -> None:
    facade = _facade()
    facade.script("list_source_providers", source_provider_list_response(provider_id))
    facade.script("list_source_connections", source_connection_list_response())
    facade.script(
        "create_source_connection",
        source_connection_response(connection_id="connector-1", provider_id=provider_id, status="active"),
    )
    facade.script(
        "import_source_workflow",
        source_workflow_response(workflow_id="connector-workflow-1", source_id="source-1", state="completed"),
    )
    facade.script(
        "get_source",
        source_response(
            metadata={"clientRequestId": "initial-source:operation-1", "preview": True},
            status="disabled",
            version=3,
        ),
    )
    facade.script(
        "update_source",
        source_response(
            metadata={"clientRequestId": "initial-source:operation-1", "preview": False},
            status="active",
            version=4,
        ),
    )
    credential = _Credential(
        id=credential_id,
        name=expected_source_name,
        provider=payload.provider,
        plugin_id=payload.plugin_id,
    )

    with _runtime(facade, credential=credential):
        result = start_initial_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=payload,
        )

    assert result == "connector-workflow-1"
    connection_payload = facade.payload("create_source_connection", KnowledgeFSSourceConnectionCreatePayload)
    assert connection_payload.provider_id == provider_id
    assert connection_payload.configuration == {
        "credentialId": credential_id,
        "datasource": payload.datasource,
        "pluginId": payload.plugin_id,
        "provider": payload.provider,
        "providerKind": "online-document" if workflow_kind == "online-document-import" else "online-drive",
    }
    source_payload = facade.payload("create_source", KnowledgeFSSourceCreatePayload)
    assert source_payload.connection_id == "connector-1"
    assert source_payload.name == expected_source_name
    assert source_payload.type == "connector"
    assert source_payload.uri == "connector://connector-1"
    assert source_payload.metadata["providerId"] == provider_id
    assert source_payload.metadata["providerName"] == expected_provider_name
    import_payload = facade.payload("import_source_workflow", KnowledgeFSSourceWorkflowImportPayload).root
    assert import_payload.kind == workflow_kind
    assert import_payload.items == payload.selection
    sync_payload = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert sync_payload.mode == ("manual" if workflow_kind == "online-drive-import" else "interval")


def test_initial_website_source_import_reuses_source_across_pages_and_preserves_failure() -> None:
    facade = _facade()
    existing_source = source_response(
        source_id="existing-source",
        metadata={"clientRequestId": "initial-website-source:operation-1"},
        status="disabled",
        version=2,
    )
    facade.script(
        "list_sources",
        source_list_response(
            source_response(source_id="other", metadata={}, status="active", version=1),
            next_cursor="next-source",
        ),
        source_list_response(existing_source),
    )
    facade.script(
        "import_selected_source_crawl",
        source_workflow_response(
            workflow_id="failed-workflow",
            state="failed",
            failure_message="Source document materialization failed",
            last_error_code="SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
        ),
    )

    assert _start(facade, _knowledge_fs_initial_source_import_payload()) == "failed-workflow"
    assert facade.call_count("create_source") == 0
    assert facade.call_count("list_source_connections") == 0
    source_update_payload = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    source_update_metadata = json_object(source_update_payload.metadata)
    assert source_update_payload.status == "disabled"
    assert "parameters" not in source_update_metadata
    assert source_update_metadata["preview"] is False
    assert json_object(source_update_metadata["initialImport"])["state"] == "failed"
    assert json_object(source_update_metadata["initialImport"])["syncPolicy"] == {
        "customIntervalSeconds": None,
        "enabled": True,
        "mode": "interval",
    }
    assert facade.call_count("update_source_sync_policy") == 0


def test_initial_website_source_import_exposes_preview_consume_rejection() -> None:
    facade = _facade()
    facade.script("consume_namespace_source_preview", KnowledgeFSProductRequestRejectedError(status_code=409))
    payload = _knowledge_fs_initial_source_import_payload().model_copy(
        update={
            "credential_id": "firecrawl-credential-1",
            "plugin_id": "langgenius/firecrawl_datasource",
            "preview_job_id": "preview-job-1",
            "selection": [
                selection.model_copy(update={"page_id": f"page-{index}"})
                for index, selection in enumerate(_knowledge_fs_initial_source_import_payload().selection, start=1)
            ],
        }
    )
    payload = payload.model_copy(
        update={"preview_configuration_fingerprint": knowledge_fs_initial_preview_configuration_fingerprint(payload)}
    )

    with pytest.raises(KnowledgeFSProductRequestRejectedError):
        _start(facade, payload)

    source_update = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    source_update_metadata = json_object(source_update.metadata)
    assert source_update.status == "disabled"
    assert source_update_metadata["preview"] is False
    assert json_object(source_update_metadata["initialImport"])["state"] == "failed"
    assert json_object(source_update_metadata["initialImport"])["errorCode"] == "SOURCE_WORKFLOW_FAILED"
    assert json_object(source_update_metadata["initialImport"])["syncPolicy"] == {
        "customIntervalSeconds": None,
        "enabled": True,
        "mode": "interval",
    }


@pytest.mark.parametrize(
    ("sync_policy", "expected_mode", "expected_enabled", "expected_custom_interval_seconds"),
    [
        ("custom", "custom", True, 129_600),
        ("manual", "manual", False, None),
        ("daily", "interval", True, None),
    ],
)
def test_initial_website_source_import_configures_remaining_sync_modes(
    sync_policy: str,
    expected_mode: str,
    expected_enabled: bool,
    expected_custom_interval_seconds: int | None,
) -> None:
    facade = _facade()
    facade.script(
        "list_source_connections",
        source_connection_list_response(
            source_connection_response(connection_id="inactive", provider_id="other", status="revoked"),
            next_cursor="next-connection",
        ),
        source_connection_list_response(
            source_connection_response(
                configuration=_FIRECRAWL_CONNECTION_CONFIGURATION,
                connection_id="connection-2",
                provider_id="plugin-daemon-website",
                status="active",
            )
        ),
    )
    facade.script("get_source_sync_policy", sync_policy_response(revision=7))

    assert _start(facade, _knowledge_fs_initial_source_import_payload(sync_policy)) == "workflow-1"
    sync_payload = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert sync_payload.mode == expected_mode
    assert sync_payload.enabled is expected_enabled
    assert sync_payload.custom_interval_seconds == expected_custom_interval_seconds
    assert sync_payload.expected_revision == 7
    assert sync_payload.expected_source_version == 4


def test_initial_website_source_import_does_not_recommit_active_source_after_retry() -> None:
    facade = _facade()
    facade.script(
        "get_source",
        source_response(
            metadata={
                "clientRequestId": "initial-website-source:operation-1",
                "preview": False,
            },
            status="active",
            version=4,
        ),
    )

    assert _start(facade, _knowledge_fs_initial_source_import_payload()) == "workflow-1"

    assert facade.call_count("update_source") == 0
    sync_payload = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert sync_payload.expected_source_version == 4


@pytest.mark.parametrize(
    ("state", "knowledge_space_id", "error_type", "message"),
    [
        (
            KnowledgeFSControlSpaceState.PROVISIONING,
            None,
            KnowledgeFSInitialSourceNotReadyError,
            "still provisioning",
        ),
        (
            KnowledgeFSControlSpaceState.ERROR,
            None,
            RuntimeError,
            "cannot accept",
        ),
        (
            KnowledgeFSControlSpaceState.ACTIVE,
            None,
            RuntimeError,
            "cannot accept",
        ),
    ],
)
def test_initial_website_source_import_rejects_unavailable_spaces(
    state: KnowledgeFSControlSpaceState,
    knowledge_space_id: str | None,
    error_type: type[Exception],
    message: str,
) -> None:
    facade = _facade()
    with (
        _runtime(facade, state=state, knowledge_space_id=knowledge_space_id),
        pytest.raises(error_type, match=message),
    ):
        start_initial_website_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=_knowledge_fs_initial_source_import_payload(),
        )


def test_initial_website_source_import_rejects_missing_control_space() -> None:
    facade = _facade()
    with _runtime(facade, control_space_found=False), pytest.raises(RuntimeError, match="control-space was not found"):
        start_initial_website_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=_knowledge_fs_initial_source_import_payload(),
        )


def test_initial_website_source_import_rejects_unavailable_provider() -> None:
    unavailable_provider = _facade()
    unavailable_provider.script("list_source_providers", source_provider_list_response())
    with pytest.raises(RuntimeError, match="provider is unavailable"):
        _start(unavailable_provider, _knowledge_fs_initial_source_import_payload())


def test_initial_website_source_import_rejects_missing_firecrawl_credential() -> None:
    facade = _facade()
    with (
        _runtime(facade, credential=None),
        pytest.raises(RuntimeError, match="credential is unavailable"),
    ):
        start_initial_website_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=_knowledge_fs_initial_source_import_payload(),
        )

    assert facade.call_count("create_source_connection") == 0
    assert facade.call_count("create_source") == 0


def test_initial_website_source_import_creates_missing_firecrawl_connection() -> None:
    facade = _facade()
    facade.script(
        "list_source_connections",
        source_connection_list_response(
            source_connection_response(connection_id="inactive", provider_id="other", status="revoked")
        ),
    )

    assert _start(facade, _knowledge_fs_initial_source_import_payload()) == "workflow-1"

    connection_payload = facade.payload("create_source_connection", KnowledgeFSSourceConnectionCreatePayload)
    assert connection_payload.auth_kind == "endpoint"
    assert connection_payload.configuration == {
        "credentialId": "firecrawl-credential-1",
        "datasource": "crawl",
        "pluginId": "langgenius/firecrawl_datasource",
        "provider": "firecrawl",
        "providerKind": "website",
    }
    assert connection_payload.credentials == {}
    assert connection_payload.provider_id == "plugin-daemon-website"
    source_payload = facade.payload("create_source", KnowledgeFSSourceCreatePayload)
    assert source_payload.connection_id == "connection-created"


def test_initial_website_source_import_retries_provisioning_firecrawl_connection() -> None:
    facade = _facade()
    facade.script(
        "list_source_connections",
        source_connection_list_response(
            source_connection_response(
                configuration=_FIRECRAWL_CONNECTION_CONFIGURATION,
                connection_id="connection-1",
                provider_id="plugin-daemon-website",
                status="provisioning",
            )
        ),
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still provisioning"):
        _start(facade, _knowledge_fs_initial_source_import_payload())

    assert facade.call_count("create_source_connection") == 0
    assert facade.call_count("create_source") == 0


def test_initial_website_source_import_retries_running_workflow() -> None:
    facade = _facade()
    facade.script(
        "import_selected_source_crawl",
        source_workflow_response(workflow_id="running-workflow", source_id="source-1", state="running"),
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still running") as raised:
        _start(facade, _knowledge_fs_initial_source_import_payload())

    assert raised.value.workflow_id == "running-workflow"


def test_initial_website_source_import_polls_existing_workflow_without_recreating_it() -> None:
    facade = _facade()

    assert _start(facade, _knowledge_fs_initial_source_import_payload(), workflow_id="workflow-1") == "workflow-1"

    assert facade.calls["get_source_workflow"] == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "run_id": "workflow-1",
        }
    ]
    assert facade.call_count("list_sources") == 0
    assert facade.call_count("list_source_connections") == 0
    assert facade.call_count("create_source") == 0
    assert facade.call_count("import_selected_source_crawl") == 0
    source_update_payload = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    assert source_update_payload.status == "active"


def test_initial_website_source_import_keeps_polling_existing_running_workflow() -> None:
    facade = _facade()
    facade.script(
        "get_source_workflow",
        source_workflow_response(workflow_id="workflow-1", source_id="source-1", state="importing"),
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still running") as raised:
        _start(facade, _knowledge_fs_initial_source_import_payload(), workflow_id="workflow-1")

    assert raised.value.workflow_id == "workflow-1"
    assert facade.call_count("import_selected_source_crawl") == 0
    assert facade.call_count("get_source") == 0


def test_initial_website_source_import_exposes_failed_source_without_activating_it() -> None:
    facade = _facade()
    facade.script(
        "get_source_workflow",
        source_workflow_response(
            workflow_id="workflow-1",
            source_id="source-1",
            state="failed",
            failure_message="Source document materialization failed",
            last_error_code="SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
        ),
    )

    assert _start(facade, _knowledge_fs_initial_source_import_payload(), workflow_id="workflow-1") == "workflow-1"

    source_update_payload = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    source_update_metadata = json_object(source_update_payload.metadata)
    assert source_update_payload.status == "disabled"
    assert source_update_metadata["preview"] is False
    initial_import = json_object(source_update_metadata["initialImport"])
    assert initial_import["errorCode"] == "SOURCE_DOCUMENT_MATERIALIZATION_FAILED"
    assert initial_import["errorMessage"] == "Source document materialization failed"
    assert initial_import["state"] == "failed"
    assert initial_import["workflowId"] == "workflow-1"
    assert initial_import["requestedSourceUrls"] == ["https://docs.dify.ai/a", "https://docs.dify.ai/b"]
    assert initial_import["canonicalSourceUrls"] == ["https://docs.dify.ai/a", "https://docs.dify.ai/b"]
    assert initial_import["syncPolicy"] == {
        "customIntervalSeconds": None,
        "enabled": True,
        "mode": "interval",
    }
    fingerprint = initial_import["configurationFingerprint"]
    assert isinstance(fingerprint, str)
    assert len(fingerprint) == 64
    assert facade.call_count("update_source_sync_policy") == 0


def test_upgrade_source_submission_succeeds_when_first_import_submission_fails() -> None:
    facade = _facade()
    facade.script(
        "create_source",
        source_response(
            connection_id="connection-1",
            metadata={"clientRequestId": "initial-website-source:operation-1", "preview": True},
            status="disabled",
            version=1,
        ),
    )
    facade.script(
        "update_source",
        source_response(
            connection_id="connection-1",
            metadata={"clientRequestId": "initial-website-source:operation-1", "preview": False},
            status="active",
            version=2,
        ),
    )
    facade.script("import_selected_source_crawl", RuntimeError("crawl queue unavailable"))

    with _runtime(facade):
        result = submit_initial_source_for_upgrade(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=_knowledge_fs_initial_source_import_payload(sync_policy="manual"),
        )

    assert result.connection_id == "connection-1"
    assert result.source_id == "source-1"
    assert result.workflow_id is None
    assert result.workflow_error == "RuntimeError"
    assert facade.call_count("update_source_sync_policy") == 1


def _knowledge_fs_initial_source_reliability_payload(
    *, limit: int = 2, urls: list[str] | None = None
) -> dict[str, object]:
    selected = urls or ["HTTPS://Docs.Dify.AI:443/a/#section", "https://docs.dify.ai/b/"]
    return {
        "kind": "website_crawl",
        "name": "Dify docs",
        "provider": "firecrawl",
        "root_url": "https://docs.dify.ai",
        "crawl_options": {"include_subpages": True, "limit": limit},
        "selection": [{"source_url": url} for url in selected],
    }


def test_initial_website_selection_populates_stable_canonical_urls() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(_knowledge_fs_initial_source_reliability_payload())

    assert [item.canonical_url for item in payload.selection] == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/b",
    ]


def test_initial_website_selection_preserves_canonical_duplicates() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        _knowledge_fs_initial_source_reliability_payload(
            urls=["https://docs.dify.ai/a/", "https://DOCS.dify.ai:443/a#section"]
        )
    )

    assert [item.source_url for item in payload.selection] == [
        "https://docs.dify.ai/a/",
        "https://DOCS.dify.ai:443/a#section",
    ]
    assert [item.canonical_url for item in payload.selection] == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/a",
    ]


def test_crawl_import_preserves_duplicate_source_urls() -> None:
    payload = KnowledgeFSCrawlImportPayload.model_validate(
        {"sourceUrls": [" https://docs.dify.ai/a ", "https://docs.dify.ai/a"]}
    )

    assert payload.source_urls == ["https://docs.dify.ai/a", "https://docs.dify.ai/a"]


def test_initial_website_selection_requires_crawl_limit_to_cover_selection() -> None:
    with pytest.raises(ValidationError, match="crawl limit must cover every selected URL"):
        KnowledgeFSInitialWebsiteSourcePayload.model_validate(_knowledge_fs_initial_source_reliability_payload(limit=1))


def test_initial_website_source_rejects_stale_preview_configuration() -> None:
    payload = _knowledge_fs_initial_source_reliability_payload()
    payload["previewConfigurationFingerprint"] = "0" * 64

    with pytest.raises(ValidationError, match="preview configuration no longer matches"):
        KnowledgeFSInitialWebsiteSourcePayload.model_validate(payload)


def test_initial_website_source_accepts_matching_preview_configuration() -> None:
    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(_knowledge_fs_initial_source_reliability_payload())
    raw = _knowledge_fs_initial_source_reliability_payload()
    raw["previewConfigurationFingerprint"] = knowledge_fs_initial_preview_configuration_fingerprint(payload)

    validated = KnowledgeFSInitialWebsiteSourcePayload.model_validate(raw)

    assert validated.preview_configuration_fingerprint == knowledge_fs_initial_preview_configuration_fingerprint(
        validated
    )

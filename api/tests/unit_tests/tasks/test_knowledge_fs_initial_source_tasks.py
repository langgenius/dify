from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from models.knowledge_fs import KnowledgeFSControlSpaceState
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialOnlineDocumentSourcePayload,
    KnowledgeFSInitialOnlineDriveSourcePayload,
    KnowledgeFSInitialWebsiteSourcePayload,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRemoteError, KnowledgeFSProductResourceNotFoundError
from tasks.knowledge_fs_initial_source_tasks import (
    KnowledgeFSInitialSourceNotReadyError,
    import_initial_source,
    import_initial_website_source,
    start_initial_source_import,
    start_initial_website_source_import,
)

_DEFAULT_CREDENTIAL = object()


def _payload(sync_policy: str = "daily") -> KnowledgeFSInitialWebsiteSourcePayload:
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


def _facade() -> MagicMock:
    facade = MagicMock()
    facade.list_sources.return_value = SimpleNamespace(data=[], next_cursor=None)
    facade.list_source_providers.return_value = SimpleNamespace(
        data=[SimpleNamespace(id="plugin-daemon-website", available=True)]
    )
    facade.list_source_connections.return_value = SimpleNamespace(
        data=[
            SimpleNamespace(
                configuration={
                    "credentialId": "firecrawl-credential-1",
                    "datasource": "crawl",
                    "pluginId": "langgenius/firecrawl_datasource",
                    "provider": "firecrawl",
                    "providerKind": "website",
                },
                id="connection-1",
                provider_id="plugin-daemon-website",
                status="active",
            )
        ],
        next_cursor=None,
    )
    facade.create_source_connection.return_value = SimpleNamespace(
        configuration={"credentialId": "firecrawl-credential-1"},
        id="connection-created",
        provider_id="plugin-daemon-website",
        status="active",
    )
    facade.create_source.return_value = SimpleNamespace(id="source-1")
    facade.import_selected_source_crawl.return_value = SimpleNamespace(
        id="workflow-1",
        source_id="source-1",
        state="completed",
    )
    facade.get_source_workflow.return_value = SimpleNamespace(
        id="workflow-1",
        source_id="source-1",
        state="completed",
    )
    facade.get_source.return_value = SimpleNamespace(
        metadata={
            "clientRequestId": "initial-website-source:operation-1",
            "preview": True,
        },
        status="disabled",
        version=3,
    )
    facade.update_source.return_value = SimpleNamespace(
        metadata={
            "clientRequestId": "initial-website-source:operation-1",
            "preview": False,
        },
        status="active",
        version=4,
    )
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("not found")
    return facade


@contextmanager
def _runtime(
    facade: MagicMock,
    *,
    credential: SimpleNamespace | None | object = _DEFAULT_CREDENTIAL,
    state: KnowledgeFSControlSpaceState = KnowledgeFSControlSpaceState.ACTIVE,
    knowledge_space_id: str | None = "space-1",
):
    session_context = MagicMock()
    session = MagicMock()
    session.scalar.return_value = (
        SimpleNamespace(id="firecrawl-credential-1", name="Firecrawl")
        if credential is _DEFAULT_CREDENTIAL
        else credential
    )
    session_context.__enter__.return_value = session
    session_maker = MagicMock(return_value=session_context)
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.session_factory.get_session_maker",
            return_value=session_maker,
        ),
        patch("tasks.knowledge_fs_initial_source_tasks.SQLAlchemyKnowledgeFSControlSpaceRepository") as repository_type,
        patch("tasks.knowledge_fs_initial_source_tasks.get_knowledge_fs_runtime") as get_runtime,
    ):
        repository_type.return_value.get.return_value = SimpleNamespace(
            state=state,
            knowledge_space_id=knowledge_space_id,
        )
        get_runtime.return_value.facade = facade
        yield repository_type


def _start(
    facade: MagicMock,
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

    assert _start(facade, _payload()) == "workflow-1"

    source_payload = facade.create_source.call_args.kwargs["payload"]
    assert source_payload.status == "disabled"
    assert source_payload.connection_id == "connection-1"
    assert source_payload.metadata["datasourceParameterMode"] == "exact"
    assert source_payload.metadata["preview"] is True
    assert source_payload.metadata["parameters"] == {
        "limit": 25,
        "url": "https://docs.dify.ai",
    }
    import_payload = facade.import_selected_source_crawl.call_args.kwargs["payload"]
    assert import_payload.source_urls == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/b",
    ]
    source_update_payload = facade.update_source.call_args.kwargs["payload"]
    assert source_update_payload.expected_version == 3
    assert source_update_payload.metadata == {
        "clientRequestId": "initial-website-source:operation-1",
        "preview": False,
    }
    assert source_update_payload.status == "active"
    sync_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert sync_payload.mode == "interval"
    assert sync_payload.enabled is True
    assert sync_payload.expected_revision == 0
    assert sync_payload.expected_source_version == 4


def test_initial_website_source_import_preserves_legacy_crawl_option_projection() -> None:
    facade = _facade()

    assert _start(facade, _legacy_payload()) == "workflow-1"

    source_payload = facade.create_source.call_args.kwargs["payload"]
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
    facade.list_source_providers.return_value = SimpleNamespace(data=[SimpleNamespace(id=provider_id, available=True)])
    facade.list_source_connections.return_value = SimpleNamespace(data=[], next_cursor=None)
    facade.create_source_connection.return_value = SimpleNamespace(id="connector-1", status="active")
    facade.import_source_workflow.return_value = SimpleNamespace(
        id="connector-workflow-1",
        source_id="source-1",
        state="completed",
    )
    facade.get_source.return_value = SimpleNamespace(
        metadata={"clientRequestId": "initial-source:operation-1", "preview": True},
        status="disabled",
        version=3,
    )
    facade.update_source.return_value = SimpleNamespace(
        metadata={"clientRequestId": "initial-source:operation-1", "preview": False},
        status="active",
        version=4,
    )
    credential = SimpleNamespace(id=credential_id, name=expected_source_name)

    with _runtime(facade, credential=credential):
        result = start_initial_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=payload,
        )

    assert result == "connector-workflow-1"
    connection_payload = facade.create_source_connection.call_args.kwargs["payload"]
    assert connection_payload.provider_id == provider_id
    assert connection_payload.configuration == {
        "credentialId": credential_id,
        "datasource": payload.datasource,
        "pluginId": payload.plugin_id,
        "provider": payload.provider,
        "providerKind": "online-document" if workflow_kind == "online-document-import" else "online-drive",
    }
    source_payload = facade.create_source.call_args.kwargs["payload"]
    assert source_payload.connection_id == "connector-1"
    assert source_payload.name == expected_source_name
    assert source_payload.type == "connector"
    assert source_payload.uri == "connector://connector-1"
    assert source_payload.metadata["providerId"] == provider_id
    assert source_payload.metadata["providerName"] == expected_provider_name
    import_payload = facade.import_source_workflow.call_args.kwargs["payload"].root
    assert import_payload.kind == workflow_kind
    assert import_payload.items == payload.selection
    sync_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert sync_payload.mode == ("manual" if workflow_kind == "online-drive-import" else "provider")


def test_initial_website_source_import_reuses_source_across_pages_and_preserves_failure() -> None:
    facade = _facade()
    existing_source = SimpleNamespace(
        id="existing-source",
        metadata={"clientRequestId": "initial-website-source:operation-1"},
    )
    facade.list_sources.side_effect = [
        SimpleNamespace(
            data=[SimpleNamespace(id="other", metadata={})],
            next_cursor="next-source",
        ),
        SimpleNamespace(data=[existing_source], next_cursor=None),
    ]
    facade.import_selected_source_crawl.return_value = SimpleNamespace(
        id="failed-workflow",
        last_error_code="SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
        last_error_message="Source document materialization failed",
        state="failed",
    )

    assert _start(facade, _payload()) == "failed-workflow"
    facade.create_source.assert_not_called()
    facade.list_source_connections.assert_not_called()
    source_update_payload = facade.update_source.call_args.kwargs["payload"]
    assert source_update_payload.status == "disabled"
    assert source_update_payload.metadata["preview"] is False
    assert source_update_payload.metadata["initialImport"]["state"] == "failed"
    facade.update_source_sync_policy.assert_not_called()


@pytest.mark.parametrize(
    ("sync_policy", "expected_mode", "expected_enabled", "expected_custom_interval_seconds"),
    [
        ("custom", "custom", True, 129_600),
        ("manual", "manual", False, None),
        ("provider", "provider", True, None),
    ],
)
def test_initial_website_source_import_configures_remaining_sync_modes(
    sync_policy: str,
    expected_mode: str,
    expected_enabled: bool,
    expected_custom_interval_seconds: int | None,
) -> None:
    facade = _facade()
    facade.list_source_connections.side_effect = [
        SimpleNamespace(
            data=[SimpleNamespace(id="inactive", provider_id="other", status="disabled")],
            next_cursor="next-connection",
        ),
        SimpleNamespace(
            data=[
                SimpleNamespace(
                    configuration={
                        "credentialId": "firecrawl-credential-1",
                        "datasource": "crawl",
                        "pluginId": "langgenius/firecrawl_datasource",
                        "provider": "firecrawl",
                        "providerKind": "website",
                    },
                    id="connection-2",
                    provider_id="plugin-daemon-website",
                    status="active",
                )
            ],
            next_cursor=None,
        ),
    ]
    facade.get_source_sync_policy.side_effect = None
    facade.get_source_sync_policy.return_value = SimpleNamespace(revision=7)

    assert _start(facade, _payload(sync_policy)) == "workflow-1"
    sync_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert sync_payload.mode == expected_mode
    assert sync_payload.enabled is expected_enabled
    assert sync_payload.custom_interval_seconds == expected_custom_interval_seconds
    assert sync_payload.expected_revision == 7
    assert sync_payload.expected_source_version == 4


def test_initial_website_source_import_does_not_recommit_active_source_after_retry() -> None:
    facade = _facade()
    facade.get_source.return_value = SimpleNamespace(
        metadata={
            "clientRequestId": "initial-website-source:operation-1",
            "preview": False,
        },
        status="active",
        version=4,
    )

    assert _start(facade, _payload()) == "workflow-1"

    facade.update_source.assert_not_called()
    sync_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
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
            payload=_payload(),
        )


def test_initial_website_source_import_rejects_missing_control_space() -> None:
    facade = _facade()
    with _runtime(facade) as repository_type:
        repository_type.return_value.get.return_value = None
        with pytest.raises(RuntimeError, match="control-space was not found"):
            start_initial_website_source_import(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-1",
                operation_id="operation-1",
                payload=_payload(),
            )


def test_initial_website_source_import_rejects_unavailable_provider() -> None:
    unavailable_provider = _facade()
    unavailable_provider.list_source_providers.return_value = SimpleNamespace(data=[])
    with pytest.raises(RuntimeError, match="provider is unavailable"):
        _start(unavailable_provider, _payload())


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
            payload=_payload(),
        )

    facade.create_source_connection.assert_not_called()
    facade.create_source.assert_not_called()


def test_initial_website_source_import_creates_missing_firecrawl_connection() -> None:
    facade = _facade()
    facade.list_source_connections.return_value = SimpleNamespace(
        data=[SimpleNamespace(id="inactive", provider_id="other", status="disabled")],
        next_cursor=None,
    )

    assert _start(facade, _payload()) == "workflow-1"

    connection_payload = facade.create_source_connection.call_args.kwargs["payload"]
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
    source_payload = facade.create_source.call_args.kwargs["payload"]
    assert source_payload.connection_id == "connection-created"


def test_initial_website_source_import_retries_provisioning_firecrawl_connection() -> None:
    facade = _facade()
    facade.list_source_connections.return_value = SimpleNamespace(
        data=[
            SimpleNamespace(
                configuration={
                    "credentialId": "firecrawl-credential-1",
                    "datasource": "crawl",
                    "pluginId": "langgenius/firecrawl_datasource",
                    "provider": "firecrawl",
                    "providerKind": "website",
                },
                id="connection-1",
                provider_id="plugin-daemon-website",
                status="provisioning",
            )
        ],
        next_cursor=None,
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still provisioning"):
        _start(facade, _payload())

    facade.create_source_connection.assert_not_called()
    facade.create_source.assert_not_called()


def test_initial_website_source_import_retries_running_workflow() -> None:
    facade = _facade()
    facade.import_selected_source_crawl.return_value = SimpleNamespace(
        id="running-workflow",
        source_id="source-1",
        state="running",
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still running") as raised:
        _start(facade, _payload())

    assert raised.value.workflow_id == "running-workflow"


def test_initial_website_source_import_polls_existing_workflow_without_recreating_it() -> None:
    facade = _facade()

    assert _start(facade, _payload(), workflow_id="workflow-1") == "workflow-1"

    facade.get_source_workflow.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        run_id="workflow-1",
    )
    facade.list_sources.assert_not_called()
    facade.list_source_connections.assert_not_called()
    facade.create_source.assert_not_called()
    facade.import_selected_source_crawl.assert_not_called()
    source_update_payload = facade.update_source.call_args.kwargs["payload"]
    assert source_update_payload.status == "active"


def test_initial_website_source_import_keeps_polling_existing_running_workflow() -> None:
    facade = _facade()
    facade.get_source_workflow.return_value = SimpleNamespace(
        id="workflow-1",
        source_id="source-1",
        state="importing",
    )

    with pytest.raises(KnowledgeFSInitialSourceNotReadyError, match="still running") as raised:
        _start(facade, _payload(), workflow_id="workflow-1")

    assert raised.value.workflow_id == "workflow-1"
    facade.import_selected_source_crawl.assert_not_called()
    facade.get_source.assert_not_called()


def test_initial_website_source_import_exposes_failed_source_without_activating_it() -> None:
    facade = _facade()
    facade.get_source_workflow.return_value = SimpleNamespace(
        id="workflow-1",
        last_error_code="SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
        last_error_message="Source document materialization failed",
        source_id="source-1",
        state="failed",
    )

    assert _start(facade, _payload(), workflow_id="workflow-1") == "workflow-1"

    source_update_payload = facade.update_source.call_args.kwargs["payload"]
    assert source_update_payload.status == "disabled"
    assert source_update_payload.metadata["preview"] is False
    assert source_update_payload.metadata["initialImport"] == {
        "errorCode": "SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
        "errorMessage": "Source document materialization failed",
        "state": "failed",
        "workflowId": "workflow-1",
    }
    facade.update_source_sync_policy.assert_not_called()


def test_initial_website_source_task_returns_result_and_retries_not_ready_error() -> None:
    serialized_payload = _payload().model_dump(mode="json")
    with patch(
        "tasks.knowledge_fs_initial_source_tasks.start_initial_website_source_import",
        return_value="workflow-1",
    ):
        assert (
            import_initial_website_source.run(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-1",
                operation_id="operation-1",
                payload=serialized_payload,
            )
            == "workflow-1"
        )

    retry_error = RuntimeError("retry requested")
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.start_initial_website_source_import",
            side_effect=KnowledgeFSInitialSourceNotReadyError("not ready"),
        ),
        patch.object(import_initial_website_source, "retry", side_effect=retry_error) as retry,
        pytest.raises(RuntimeError, match="retry requested"),
    ):
        import_initial_website_source.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=serialized_payload,
        )
    retry.assert_called_once()


def test_initial_website_source_task_retries_with_workflow_id() -> None:
    serialized_payload = _payload().model_dump(mode="json")
    retry_error = RuntimeError("retry requested")
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.start_initial_website_source_import",
            side_effect=KnowledgeFSInitialSourceNotReadyError(
                "not ready",
                workflow_id="workflow-1",
            ),
        ),
        patch.object(import_initial_website_source, "retry", side_effect=retry_error) as retry,
        pytest.raises(RuntimeError, match="retry requested"),
    ):
        import_initial_website_source.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=serialized_payload,
        )

    retry.assert_called_once_with(
        exc=retry.call_args.kwargs["exc"],
        kwargs={
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "operation-1",
            "payload": serialized_payload,
            "workflow_id": "workflow-1",
        },
    )


def test_initial_source_task_validates_discriminated_connector_payload() -> None:
    serialized_payload = _document_payload().model_dump(mode="json", by_alias=True)
    with patch(
        "tasks.knowledge_fs_initial_source_tasks.start_initial_source_import",
        return_value="workflow-1",
    ) as start_import:
        assert (
            import_initial_source.run(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-1",
                operation_id="operation-1",
                payload=serialized_payload,
            )
            == "workflow-1"
        )

    parsed_payload = start_import.call_args.kwargs["payload"]
    assert isinstance(parsed_payload, KnowledgeFSInitialOnlineDocumentSourcePayload)
    assert parsed_payload.credential_id == "notion-credential-1"


def test_initial_source_task_retries_transient_remote_error() -> None:
    serialized_payload = _drive_payload().model_dump(mode="json", by_alias=True)
    remote_error = KnowledgeFSProductRemoteError("temporary outage")
    retry_error = RuntimeError("retry requested")
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.start_initial_source_import",
            side_effect=remote_error,
        ),
        patch.object(import_initial_source, "retry", side_effect=retry_error) as retry,
        pytest.raises(RuntimeError, match="retry requested"),
    ):
        import_initial_source.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=serialized_payload,
            workflow_id="workflow-1",
        )

    retry.assert_called_once_with(exc=remote_error)


def test_initial_source_task_does_not_retry_authoritative_missing_resource() -> None:
    serialized_payload = _drive_payload().model_dump(mode="json", by_alias=True)
    missing_resource = KnowledgeFSProductResourceNotFoundError("workflow was not found")
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.start_initial_source_import",
            side_effect=missing_resource,
        ),
        patch.object(import_initial_source, "retry") as retry,
        pytest.raises(KnowledgeFSProductResourceNotFoundError, match="workflow was not found"),
    ):
        import_initial_source.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=serialized_payload,
            workflow_id="workflow-1",
        )

    retry.assert_not_called()

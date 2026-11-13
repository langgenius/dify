from unittest.mock import patch

import pytest

from services.knowledge_fs.initial_source_import import KnowledgeFSInitialSourceNotReadyError
from services.knowledge_fs.product_dto import (
    KnowledgeFSInitialOnlineDocumentSourcePayload,
    KnowledgeFSInitialOnlineDriveSourcePayload,
    KnowledgeFSInitialWebsiteSourcePayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from tasks.knowledge_fs_initial_source_tasks import import_initial_source, import_initial_website_source


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


def test_initial_source_task_retries_rate_limited_request() -> None:
    serialized_payload = _payload().model_dump(mode="json", by_alias=True)
    rejected = KnowledgeFSProductRequestRejectedError(status_code=429)
    retry_error = RuntimeError("retry requested")
    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.start_initial_source_import",
            side_effect=rejected,
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
            workflow_id=None,
        )

    retry.assert_called_once_with(exc=rejected)


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

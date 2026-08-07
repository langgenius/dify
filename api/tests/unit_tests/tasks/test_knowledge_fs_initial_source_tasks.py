from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from models.knowledge_fs import KnowledgeFSControlSpaceState
from services.knowledge_fs.product_dto import KnowledgeFSInitialWebsiteSourcePayload
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError
from tasks.knowledge_fs_initial_source_tasks import start_initial_website_source_import


def test_initial_website_source_import_recrawls_exact_selection_and_configures_sync() -> None:
    session_context = MagicMock()
    session_context.__enter__.return_value = object()
    session_maker = MagicMock(return_value=session_context)
    facade = MagicMock()
    facade.list_sources.return_value = SimpleNamespace(data=[], next_cursor=None)
    facade.list_source_providers.return_value = SimpleNamespace(
        data=[SimpleNamespace(id="plugin-daemon-website", available=True)]
    )
    facade.list_source_connections.return_value = SimpleNamespace(
        data=[
            SimpleNamespace(
                id="connection-1",
                provider_id="plugin-daemon-website",
                status="active",
            )
        ],
        next_cursor=None,
    )
    facade.create_source.return_value = SimpleNamespace(id="source-1")
    facade.import_selected_source_crawl.return_value = SimpleNamespace(
        id="workflow-1",
        state="completed",
    )
    facade.get_source.return_value = SimpleNamespace(version=3)
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("not found")

    payload = KnowledgeFSInitialWebsiteSourcePayload.model_validate(
        {
            "kind": "website_crawl",
            "name": "Dify docs",
            "provider": "firecrawl",
            "root_url": "https://docs.dify.ai",
            "crawl_options": {"include_subpages": True, "limit": 25},
            "selection": [
                {"source_url": "https://docs.dify.ai/a", "title": "A"},
                {"source_url": "https://docs.dify.ai/b", "title": "B"},
            ],
            "sync_policy": "daily",
        }
    )

    with (
        patch(
            "tasks.knowledge_fs_initial_source_tasks.session_factory.get_session_maker",
            return_value=session_maker,
        ),
        patch(
            "tasks.knowledge_fs_initial_source_tasks.SQLAlchemyKnowledgeFSControlSpaceRepository"
        ) as repository_type,
        patch("tasks.knowledge_fs_initial_source_tasks.get_knowledge_fs_runtime") as get_runtime,
    ):
        repository_type.return_value.get.return_value = SimpleNamespace(
            state=KnowledgeFSControlSpaceState.ACTIVE,
            knowledge_space_id="space-1",
        )
        get_runtime.return_value.facade = facade

        workflow_id = start_initial_website_source_import(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            operation_id="operation-1",
            payload=payload,
        )

    assert workflow_id == "workflow-1"
    source_payload = facade.create_source.call_args.kwargs["payload"]
    assert source_payload.status == "disabled"
    assert source_payload.metadata["preview"] is True
    import_payload = facade.import_selected_source_crawl.call_args.kwargs["payload"]
    assert import_payload.source_urls == [
        "https://docs.dify.ai/a",
        "https://docs.dify.ai/b",
    ]
    sync_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert sync_payload.mode == "interval"
    assert sync_payload.enabled is True
    assert sync_payload.expected_source_version == 3

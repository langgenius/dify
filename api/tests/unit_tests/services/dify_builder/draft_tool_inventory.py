"""ENG-1200 external daemon boundary with real declarations and credential SQL."""

from dataclasses import dataclass
from typing import cast

import pytest
from sqlalchemy.engine import Engine

from core.dify_builder.models import Graph
from services.credentials.query import CredentialQuery
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    OTHER_TENANT_ID,
    TENANT_ID,
    FakeTool,
    FakeToolDaemon,
    InventoryDatabase,
    bind_database,
    forbid_secret_and_business_calls,
    install_fake_daemon,
    provider_payload,
)

AUTH_PROVIDER = "acme/huddle/huddle"
FREE_PROVIDER = "acme/free/free"
APP_ID = "cccccccc-0000-4000-8000-000000000001"
DRAFT_ID = "dddddddd-0000-4000-8000-000000000001"


@dataclass
class DraftToolInventory:
    daemon: FakeToolDaemon
    queries: CredentialQuery
    forbidden: list[str]
    engine: Engine


@pytest.fixture
def draft_tools(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> DraftToolInventory:
    """Installation, transformation, query and visibility owners stay real."""
    from flask import current_app

    import extensions.ext_application_services as application_module
    import services.workflow_service as workflow_module
    from services.dify_builder.agent import resources

    bind_database(monkeypatch, sqlite_engine)
    application = resources.application_services()
    queries = application.credential_queries
    # Preserve the actual application-services accessor even for consumers
    # imported before this fixture; replace only the external composition root.
    monkeypatch.setitem(current_app.extensions, application_module._EXTENSION_KEY, application)
    monkeypatch.setattr(resources, "application_services", application_module.application_services)
    monkeypatch.setattr(workflow_module, "db", InventoryDatabase(engine=sqlite_engine))
    auth = provider_payload(
        "acme/huddle",
        "huddle",
        [FakeTool("post", "Post to Huddle", "Post a message to a channel.")],
        needs_credentials=True,
    )
    declaration = cast(Graph, auth["declaration"])
    declaration["tools"][0]["parameters"] = [
        {
            "name": "message",
            "type": "string",
            "required": True,
            "form": "llm",
            "label": {"en_US": "Message"},
            "human_description": {"en_US": "Message to post"},
            "llm_description": "Message to post",
        }
    ]
    declaration["tools"][0]["output_schema"] = {"type": "object", "properties": {"message_id": {"type": "string"}}}
    daemon = install_fake_daemon(
        monkeypatch,
        FakeToolDaemon(
            providers_by_tenant={
                TENANT_ID: [auth, provider_payload("acme/free", "free", [FakeTool("echo", "Echo")])],
                OTHER_TENANT_ID: [provider_payload("foreign/huddle", "huddle", [FakeTool("post", "Foreign post")])],
            }
        ),
    )
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    return DraftToolInventory(daemon, queries, forbid_secret_and_business_calls(monkeypatch), sqlite_engine)

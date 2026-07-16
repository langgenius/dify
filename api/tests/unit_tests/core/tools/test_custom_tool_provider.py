"""Tests for custom API tool providers with persisted provider lookup state."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.tools.custom_tool import provider as provider_module
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolProviderType
from models.base import TypeBase
from models.tools import ApiToolProvider


@dataclass(frozen=True)
class _Database:
    session: Session


@pytest.fixture
def provider_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Yield an isolated session containing the API tool provider table."""

    table = TypeBase.metadata.tables[ApiToolProvider.__tablename__]
    TypeBase.metadata.create_all(sqlite_engine, tables=[table])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _db_provider() -> SimpleNamespace:
    bundle = ApiToolBundle(
        server_url="https://api.example.com/items",
        method="GET",
        summary="List items",
        operation_id="list_items",
        parameters=[],
        author="author",
        openapi={"parameters": []},
    )
    return SimpleNamespace(
        id="provider-id",
        tenant_id="tenant-1",
        name="provider-a",
        description="desc",
        icon="icon.svg",
        user=SimpleNamespace(name="Alice"),
        tools=[bundle],
    )


def _persist_provider(session: Session, *, tenant_id: str, name: str = "provider-a") -> ApiToolProvider:
    bundle = _db_provider().tools[0]
    provider = ApiToolProvider(
        name=name,
        icon="icon.svg",
        schema="{}",
        schema_type_str="openapi",
        user_id=str(uuid4()),
        tenant_id=tenant_id,
        description="desc",
        tools_str=json.dumps([bundle.model_dump(mode="json")]),
        credentials_str='{"auth_type":"none"}',
    )
    session.add(provider)
    session.commit()
    return provider


def test_api_tool_provider_from_db_and_parse_tool_bundle():
    controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.API_KEY_HEADER)
    assert controller.provider_type == ToolProviderType.API
    assert any(c.name == "api_key_value" for c in controller.entity.credentials_schema)

    tool = controller._parse_tool_bundle(_db_provider().tools[0])
    assert isinstance(tool, ApiTool)
    assert tool.entity.identity.provider == "provider-id"


def test_api_tool_provider_from_db_query_auth_and_none_auth():
    query_controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.API_KEY_QUERY)
    assert any(c.name == "api_key_query_param" for c in query_controller.entity.credentials_schema)

    none_controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.NONE)
    assert [c.name for c in none_controller.entity.credentials_schema] == ["auth_type"]


def test_api_tool_provider_load_get_tools_and_get_tool(monkeypatch: pytest.MonkeyPatch, provider_session: Session):
    controller = ApiToolProviderController.from_db(_db_provider(), ApiProviderAuthType.NONE)
    loaded = controller.load_bundled_tools(_db_provider().tools)
    assert len(loaded) == 1

    assert isinstance(controller.get_tool("list_items"), ApiTool)

    with pytest.raises(ValueError, match="not found"):
        controller.get_tool("missing")

    # Return cached tools without querying database.
    cached = controller.get_tools("tenant-1")
    assert len(cached) == 1

    # Force DB fetch branch.
    controller.tools = []
    tenant_id = str(uuid4())
    provider_with_tools = _persist_provider(provider_session, tenant_id=tenant_id)
    _persist_provider(provider_session, tenant_id=str(uuid4()))
    controller.tenant_id = tenant_id
    monkeypatch.setattr(provider_module, "db", _Database(session=provider_session))

    tools = controller.get_tools(tenant_id)
    assert len(tools) == 1
    assert tools[0].entity.identity.provider == controller.provider_id

    provider_session.execute(delete(ApiToolProvider).where(ApiToolProvider.id == provider_with_tools.id))
    provider_session.commit()
    controller.tools = []
    assert controller.get_tools(tenant_id) == []

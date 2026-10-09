"""Exercise Agent API-tool invocation through real provider and credentials reads."""

import json
from collections.abc import Iterator
from typing import cast

import httpx
import pytest
from sqlalchemy import Table, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.db import session_factory
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderSchemaType
from core.tools.errors import ToolInvokeError
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.ext_database import db
from models.account import Account
from models.base import TypeBase
from models.model import App
from models.tools import ApiToolProvider
from services.entities.agent_tool_inner import AgentToolInvokeRequest
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from tests.unit_tests.model_factories import make_account
from tests.unit_tests.services.agent.test_tool_invocation_service import (
    TENANT_ID,
    USER_ID,
    _persist_app,
    _request,
    _service,
)

type Databases = tuple[sessionmaker[Session], Session]


@pytest.fixture
def databases(monkeypatch: pytest.MonkeyPatch) -> Iterator[Databases]:
    engines = [create_engine("sqlite://", poolclass=QueuePool) for _ in range(2)]
    for engine in engines:
        tables: list[Table] = []
        for model in (App, Account, ApiToolProvider):
            table = model.__table__
            assert isinstance(table, Table)
            tables.append(table)
        TypeBase.metadata.create_all(engine, tables=tables)
    sessions, global_sessions = [sessionmaker(engine, expire_on_commit=False) for engine in engines]
    with global_sessions() as global_session:
        monkeypatch.setattr(db, "session", global_session)
        monkeypatch.setattr(type(db), "engine", property(lambda _db: engines[1]))
        monkeypatch.setattr(session_factory, "create_session", global_sessions)

        def reject_global(*_args: object) -> None:
            pytest.fail("Tool runtime queried the global database")

        event.listen(engines[1], "before_cursor_execute", reject_global)
        try:
            yield sessions, global_session
        finally:
            global_session.close()
            for engine in engines:
                engine.dispose()


@pytest.mark.parametrize("http_failure", [False, True])
def test_api_tool_provider_read_finishes_before_decryption_and_http(
    databases: Databases, monkeypatch: pytest.MonkeyPatch, http_failure: bool
) -> None:
    sessions, global_session = databases
    with sessions() as session:
        _persist_app(session)
        session.add(make_account(account_id=USER_ID, name="Injected author"))
        provider = ApiToolProvider(
            name="search",
            icon="icon.svg",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            description="Search",
            credentials_str=json.dumps({"auth_type": "api_key_header", "api_key_value": "encrypted"}),
            tools_str=json.dumps(
                [
                    ApiToolBundle(
                        server_url="https://api.example.com/search",
                        method="GET",
                        operation_id="search",
                        summary="Search",
                        author="Injected author",
                        parameters=[],
                        openapi={"parameters": []},
                    ).model_dump(mode="json")
                ]
            ),
        )
        session.add(provider)
        session.commit()
    engine = sessions.kw["bind"]
    calls: list[str] = []

    def released() -> None:
        assert engine.pool.checkedout() == 0
        assert not global_session.in_transaction()

    class Decrypter:
        def decrypt(self, credentials: dict[str, object]) -> dict[str, object]:
            released()
            assert credentials["api_key_value"] == "encrypted"
            calls.append("decrypt")
            return {**credentials, "api_key_value": "clear-secret"}

    def encryption(*, tenant_id: str, controller: ApiToolProviderController) -> tuple[Decrypter, None]:
        released()
        assert tenant_id == TENANT_ID
        assert controller.entity.identity.author == "Injected author"
        return Decrypter(), None

    def http_get(url: str, **kwargs: object) -> httpx.Response:
        released()
        assert url == "https://api.example.com/search"
        headers = cast(dict[str, str], kwargs["headers"])
        assert headers["Authorization"] == "clear-secret"
        calls.append("http")
        if http_failure:
            raise ToolInvokeError("remote unavailable")
        return httpx.Response(200, text="ok", request=httpx.Request("GET", url))

    monkeypatch.setattr("services.tools.tool_manager.create_tool_provider_encrypter", encryption)
    monkeypatch.setattr("core.tools.custom_tool.tool.ssrf_proxy.get", http_get)
    payload = _request().model_dump()
    payload["tool"].update(provider_type="api", provider_id=provider.id, tool_parameters={}, runtime_parameters={})
    request = AgentToolInvokeRequest.model_validate(payload)
    runtime = build_workflow_execution_dependencies(sessions)
    with sessions() as session:
        service = _service(session, runtime)
        if http_failure:
            with pytest.raises(AgentToolInnerServiceError) as exc:
                service.invoke(request)
            assert exc.value.error_code == "agent_tool_invoke_failed"
        else:
            assert service.invoke(request).observation == "ok"
    assert calls == ["decrypt", "http"]
    released()


def test_api_provider_lookup_is_tenant_scoped(databases: Databases) -> None:
    sessions, _ = databases
    with sessions.begin() as session:
        provider = ApiToolProvider(
            name="private",
            icon="",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            description="",
            credentials_str="{}",
            tools_str="[]",
        )
        session.add(provider)
    runtime = build_workflow_execution_dependencies(sessions)
    assert runtime.tool_providers.get(tenant_id="other-tenant", provider_id=provider.id) is None
    record = runtime.tool_providers.get(tenant_id=TENANT_ID, provider_id=provider.id)
    assert record is not None
    assert record.author == ""
    assert record.tools == []
    assert sessions.kw["bind"].pool.checkedout() == 0

"""Exercise selected builtin credentials through real repositories and real tool construction."""

import json
from collections.abc import Generator, Iterator
from typing import cast
from unittest.mock import create_autospec
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.db import session_factory
from core.plugin.entities.plugin_daemon import CredentialType, PluginOAuthCredentialsResponse
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin, ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from extensions.application_services.workflow import build_workflow_execution_dependencies
from extensions.ext_database import db
from models.account import Account
from models.base import TypeBase
from models.tools import BuiltinToolProvider, MCPToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from services.entities.agent_tool_inner import AgentToolInvokeRequest
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from services.tools.agent_invocation_gateway import AgentToolInvocationGateway
from services.tools.builtin import credentials as credentials_module
from services.tools.tool_manager import ToolManager
from services.workflow.variable_contracts import WorkflowExecutionVariables

TENANT = "tenant"
PROVIDER = "vendor/search/search"


@pytest.fixture
def databases(
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[sessionmaker[Session], Session], None, None]:
    engines: list[Engine] = [create_engine("sqlite://", poolclass=QueuePool) for _ in range(2)]
    for engine in engines:
        TypeBase.metadata.create_all(
            engine,
            tables=cast(
                list[Table],
                [
                    model.__table__
                    for model in (
                        Account,
                        BuiltinToolProvider,
                        ToolOAuthTenantClient,
                        ToolOAuthSystemClient,
                        MCPToolProvider,
                    )
                ],
            ),
        )
    sessions: sessionmaker[Session] = sessionmaker(engines[0], expire_on_commit=False)
    global_sessions: sessionmaker[Session] = sessionmaker(engines[1], expire_on_commit=False)
    with global_sessions() as global_session:
        monkeypatch.setattr(db, "session", global_session)
        monkeypatch.setattr(type(db), "engine", property(lambda _db: engines[1]))
        monkeypatch.setattr(session_factory, "create_session", global_sessions)

        def reject_global(*_args: object) -> None:
            pytest.fail("Tool runtime read the global database")

        event.listen(engines[1], "before_cursor_execute", reject_global)
        try:
            yield sessions, global_session
        finally:
            global_session.close()
            for engine in engines:
                engine.dispose()


def seed(
    sessions: sessionmaker[Session],
    *,
    expires_at: int = 1,
    oauth_client: str = "tenant",
) -> str:
    with sessions.begin() as session:
        credential = BuiltinToolProvider(
            tenant_id=TENANT,
            user_id="owner",
            provider=PROVIDER,
            name="Selected",
            encrypted_credentials=json.dumps({"token": "encrypted-old"}),
            credential_type=CredentialType.OAUTH2,
            expires_at=expires_at,
        )
        session.add(credential)
        if oauth_client == "tenant":
            client = ToolOAuthTenantClient(tenant_id=TENANT, plugin_id="vendor/search", provider="search")
            client.encrypted_oauth_params = json.dumps({"client": "encrypted-client"})
            session.add(client)
        elif oauth_client == "system":
            session.add(
                ToolOAuthSystemClient(plugin_id="vendor/search", provider="search", encrypted_oauth_params="system")
            )
    return credential.id


def controller() -> PluginToolProviderController:
    entity = ToolProviderEntityWithPlugin.model_validate(
        {
            "identity": {
                "author": "author",
                "name": PROVIDER,
                "description": {"en_US": "Search"},
                "icon": "icon.svg",
                "label": {"en_US": "Search"},
            },
            "credentials_schema": [
                {"name": "token", "label": {"en_US": "Token"}, "type": "secret-input", "required": True}
            ],
            "oauth_schema": {"client_schema": [], "credentials_schema": []},
            "tools": [
                {"identity": {"author": "author", "name": "search", "provider": PROVIDER, "label": {"en_US": "Search"}}}
            ],
        }
    )
    return PluginToolProviderController(
        entity=entity, plugin_id="vendor/search", plugin_unique_identifier="vendor/search:1", tenant_id=TENANT
    )


@pytest.mark.parametrize("client", ["tenant", "system"])
@pytest.mark.parametrize("outcome", ["success", "refresh-error", "concurrent-edit", "concurrent-delete"])
def test_selected_oauth_credential_releases_connections_across_full_invocation(
    databases: tuple[sessionmaker[Session], Session],
    monkeypatch: pytest.MonkeyPatch,
    client: str,
    outcome: str,
) -> None:
    sessions, global_session = databases
    credential_id = seed(sessions, oauth_client=client)
    runtime = build_workflow_execution_dependencies(sessions)
    calls: list[str] = []

    def released() -> None:
        assert sessions.kw["bind"].pool.checkedout() == 0
        assert not global_session.in_transaction()

    class Codec:
        def decrypt(self, values: dict[str, str]) -> dict[str, str]:
            released()
            calls.append("decrypt")
            return {k: v.removeprefix("encrypted-") for k, v in values.items()}

        def encrypt(self, values: dict[str, str]) -> dict[str, str]:
            released()
            calls.append("encrypt")
            return {k: "encrypted-" + v for k, v in values.items()}

    class Cache:
        def delete(self) -> None:
            released()
            calls.append("invalidate")

    def encrypter(**_kwargs: object) -> tuple[Codec, Cache]:
        released()
        return Codec(), Cache()

    def policy(**kwargs: object) -> None:
        released()
        assert kwargs["check_existence"] is False
        assert kwargs["credential_id"] == credential_id
        calls.append("policy")

    def refresh(_self: object, **kwargs: object) -> PluginOAuthCredentialsResponse:
        released()
        calls.append("refresh")
        assert kwargs["credentials"] == {"token": "old"}
        assert kwargs["system_credentials"] == {"client": "client"}
        if outcome == "refresh-error":
            raise ValueError("broker unavailable")
        if outcome in {"concurrent-edit", "concurrent-delete"}:
            with sessions.begin() as session:
                record = session.get(BuiltinToolProvider, credential_id)
                assert record is not None
                if outcome == "concurrent-delete":
                    session.delete(record)
                else:
                    record.encrypted_credentials = '{"token":"manual-edit"}'
        return PluginOAuthCredentialsResponse(credentials={"token": "new"}, expires_at=4_000_000_000)

    def invoke(_self: object, **kwargs: object) -> Iterator[object]:
        released()
        calls.append("invoke")
        assert kwargs["credentials"] == {"token": "new"}
        return iter(())

    def verified(*_args: object) -> bool:
        released()
        calls.append("verified")
        return True

    def decrypt_system(params: str) -> dict[str, str]:
        released()
        assert params == "system"
        return {"client": "client"}

    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: controller())
    monkeypatch.setattr(credentials_module, "create_provider_encrypter", encrypter)
    monkeypatch.setattr(credentials_module, "runtime_check_credential_policy_compliance", policy)
    monkeypatch.setattr(credentials_module.OAuthHandler, "refresh_credentials", refresh)
    monkeypatch.setattr(credentials_module.PluginService, "is_plugin_verified", verified)
    monkeypatch.setattr(credentials_module, "decrypt_system_params", decrypt_system)
    monkeypatch.setattr("core.plugin.impl.tool.PluginToolManager.invoke", invoke)

    variables = create_autospec(WorkflowExecutionVariables, instance=True, spec_set=True)
    variables.saver_factory.side_effect = AssertionError("No workflow variables for this tool")

    request = AgentToolInvokeRequest.model_validate(
        {
            "caller": {
                "tenant_id": TENANT,
                "user_id": "caller",
                "user_from": "account",
                "app_id": "app",
                "invoke_from": "debugger",
            },
            "tool": {
                "provider_type": "builtin",
                "provider_id": PROVIDER,
                "tool_name": "search",
                "credential_id": credential_id,
            },
        }
    )
    gateway = AgentToolInvocationGateway(variables=variables, runtime=runtime)
    if outcome == "success":
        gateway.invoke(request)
        assert calls[-1] == "invoke"
    else:
        with pytest.raises(AgentToolInnerServiceError) as exc:
            gateway.invoke(request)
        assert exc.value.error_code == "agent_tool_credential_invalid"
        assert "invoke" not in calls
    released()
    with sessions() as session:
        persisted = session.get(BuiltinToolProvider, credential_id)
        if outcome == "concurrent-delete":
            assert persisted is None
        else:
            assert persisted is not None
            expected = {"success": "encrypted-new", "refresh-error": "encrypted-old", "concurrent-edit": "manual-edit"}[
                outcome
            ]
            assert persisted.credentials == {"token": expected}
            assert persisted.expires_at == (4_000_000_000 if outcome == "success" else 1)


@pytest.mark.parametrize("wrong_scope", ["tenant", "provider"])
def test_selected_credential_cannot_cross_owner_scope(
    databases: tuple[sessionmaker[Session], Session],
    monkeypatch: pytest.MonkeyPatch,
    wrong_scope: str,
) -> None:
    sessions, _ = databases
    credential_id = seed(sessions, expires_at=-1)
    with sessions.begin() as session:
        record = session.get(BuiltinToolProvider, credential_id)
        assert record is not None
        if wrong_scope == "tenant":
            record.tenant_id = "other"
        else:
            record.provider = "other/provider"
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: controller())
    runtime = build_workflow_execution_dependencies(sessions)
    with pytest.raises(ToolProviderCredentialValidationError, match="has been deleted"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id=PROVIDER,
            tool_name="search",
            tenant_id=TENANT,
            credential_id=credential_id,
            tool_providers=runtime.tool_providers,
            workflow_queries=runtime.tools,
        )


@pytest.mark.parametrize("reference", ["id", "identifier", "uuid-identifier", "missing", "other-tenant"])
def test_mcp_runtime_resolves_injected_provider_before_decryption(
    databases: tuple[sessionmaker[Session], Session],
    monkeypatch: pytest.MonkeyPatch,
    reference: str,
) -> None:
    sessions, _ = databases
    with sessions.begin() as session:
        record = MCPToolProvider(
            name="server",
            server_identifier=str(uuid4()) if reference == "uuid-identifier" else "server",
            server_url="encrypted-url",
            server_url_hash="hash",
            icon="icon.svg",
            tenant_id=TENANT,
            user_id="owner",
        )
        session.add(record)

    def build(provider: MCPToolProvider) -> str:
        assert sessions.kw["bind"].pool.checkedout() == 0
        assert provider.id == record.id
        return "controller"

    monkeypatch.setattr("services.tools.tool_manager.MCPToolProviderController.from_db", build)
    key = record.id if reference == "id" else "missing" if reference == "missing" else record.server_identifier
    providers = build_workflow_execution_dependencies(sessions).tool_providers
    if reference in {"missing", "other-tenant"}:
        with pytest.raises(ToolProviderNotFoundError):
            ToolManager.get_mcp_provider_controller(
                "other" if reference == "other-tenant" else TENANT, key, tool_providers=providers
            )
    else:
        assert ToolManager.get_mcp_provider_controller(TENANT, key, tool_providers=providers) == "controller"

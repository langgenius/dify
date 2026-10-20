"""Provider presentation and execution share tenant-scoped, detached records."""

import json
from collections.abc import Generator, Mapping
from datetime import datetime
from typing import NoReturn
from uuid import uuid4

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.db import session_factory
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolProviderType
from core.tools.errors import ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from models.account import Account
from models.base import TypeBase
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, ToolLabelBinding, WorkflowToolProvider
from repositories.tools.provider_repository import ToolProviderRepository
from repositories.tools.workflow_repository import WorkflowToolRepository
from services.tools.api.provider import ApiToolProviderController
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.tool_manager import ToolManager
from services.tools.tools_transform_service import ToolTransformService
from tests.unit_tests.model_factories import make_account

type Database = tuple[sessionmaker[Session], ToolProviderRepository]


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Generator[Database, None, None]:
    engines = [create_engine("sqlite://", poolclass=QueuePool) for _ in range(2)]
    tables: list[Table] = []
    for model in (
        Account,
        ApiToolProvider,
        BuiltinToolProvider,
        MCPToolProvider,
        WorkflowToolProvider,
        ToolLabelBinding,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        tables.append(table)
    for engine in engines:
        TypeBase.metadata.create_all(engine, tables=tables)
    sessions, global_sessions = [sessionmaker(e, expire_on_commit=False) for e in engines]

    def reject_global(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("Provider metadata used the global database")

    def guarded_engine(_database: object) -> Engine:
        return engines[1]

    event.listen(engines[1], "before_cursor_execute", reject_global)
    monkeypatch.setattr(session_factory, "create_session", global_sessions)
    # A real global Session would check out the separately guarded database.
    with global_sessions() as global_session:
        from extensions.ext_database import db

        monkeypatch.setattr(db, "session", global_session)
        monkeypatch.setattr(type(db), "engine", property(guarded_engine))
        try:
            yield sessions, ToolProviderRepository(sessions)
        finally:
            for engine in engines:
                engine.dispose()


def api_provider(
    *, tenant_id: str = "tenant", name: str = "search", author: str = "author", auth: str = "api_key_query"
) -> ApiToolProvider:
    return ApiToolProvider(
        name=name,
        tenant_id=tenant_id,
        user_id=author,
        description="Search",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        icon=json.dumps({"content": "A", "background": "#000"}),
        tools_str="[]",
        credentials_str=json.dumps({"auth_type": auth, "api_key_value": "encrypted"}),
        privacy_policy="privacy",
        custom_disclaimer="disclaimer",
    )


@pytest.mark.parametrize(
    ("auth", "field"),
    [
        ("api_key_header", "api_key_header"),
        ("api_key", "api_key_header"),
        ("api_key_query", "api_key_query_param"),
        ("unknown", None),
    ],
)
def test_list_detail_and_runtime_use_same_loaded_author_and_release_before_decryption(
    database: Database, monkeypatch: pytest.MonkeyPatch, auth: str, field: str | None
) -> None:
    sessions, providers = database
    with sessions.begin() as session:
        session.add(make_account(account_id="author", name="Repository author"))
        row = api_provider(auth=auth)
        foreign = api_provider(tenant_id="foreign")
        session.add_all([row, foreign])
        session.flush()
        session.add(ToolLabelBinding(tool_id=row.id, tool_type=ToolProviderType.API, label_name="search"))
        session.add(ToolLabelBinding(tool_id=foreign.id, tool_type=ToolProviderType.API, label_name="foreign-label"))
    statements: list[str] = []

    def record_statement(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(sessions.kw["bind"], "before_cursor_execute", record_statement)
    calls: list[str] = []

    class Encrypter:
        def decrypt(self, data: Mapping[str, object]) -> Mapping[str, object]:
            assert sessions.kw["bind"].pool.checkedout() == 0
            calls.append("decrypt")
            return {**data, "api_key_value": "secret"}

        def mask_plugin_credentials(self, data: Mapping[str, object]) -> Mapping[str, object]:
            return {**data, "api_key_value": "***"}

    def encryption(*, tenant_id: str, controller: ApiToolProviderController) -> tuple[Encrypter, None]:
        assert tenant_id == "tenant"
        assert sessions.kw["bind"].pool.checkedout() == 0
        assert controller.entity.identity.author == "Repository author"
        fields = {item.name for item in controller.get_credentials_schema()}
        assert (field in fields) if field else fields == {"auth_type"}
        return Encrypter(), None

    monkeypatch.setattr("services.tools.tool_manager.create_tool_provider_encrypter", encryption)
    result = ToolManager.list_providers_from_api(
        "user", "tenant", "api", workflow_queries=WorkflowToolRepository(sessions), tool_providers=providers
    )
    assert len(result) == 1
    assert result[0].author == "Repository author"
    assert result[0].labels == ["search"]
    assert len(statements) == 2  # One joined provider/author read and one batch label read.
    detail = ApiToolManageService.get_api_tool_provider("user", "tenant", "search", tool_providers=providers)
    assert detail["labels"] == ["search"]
    assert detail["credentials"]["api_key_value"] == "***"
    assert detail["privacy_policy"] == "privacy"
    controller, credentials = ToolManager.get_api_provider_controller("tenant", row.id, tool_providers=providers)
    assert controller.entity.identity.author == result[0].author
    assert credentials["auth_type"] == auth
    assert calls == ["decrypt"]
    assert providers.get(tenant_id="foreign", provider_id=row.id) is None
    assert providers.api_labels(tenant_id="foreign", provider_ids=[row.id]) == {}
    with pytest.raises(ToolProviderNotFoundError):
        ToolManager.user_get_api_provider("missing", "tenant", tool_providers=providers)


def test_authorless_record_converts_without_querying(database: Database) -> None:
    sessions, providers = database
    with sessions.begin() as session:
        row = api_provider(author="deleted")
        session.add(row)
    record = providers.get(tenant_id="tenant", provider_id=row.id)
    assert record is not None

    def reject_query(*_args: object) -> NoReturn:
        pytest.fail("Detached conversion queried the database")

    event.listen(sessions.kw["bind"], "before_cursor_execute", reject_query)
    controller = ToolTransformService.api_provider_to_controller(record)
    result = ToolTransformService.api_provider_to_user_provider(controller, record, decrypt_credentials=False)
    assert result.author == ""


@pytest.mark.parametrize("provider_type", [ToolProviderType.API, ToolProviderType.WORKFLOW, ToolProviderType.MCP])
def test_icons_use_injected_repository_and_tenant_scope(database: Database, provider_type: ToolProviderType) -> None:
    sessions, providers = database
    with sessions.begin() as session:
        if provider_type == ToolProviderType.API:
            row = api_provider()
        elif provider_type == ToolProviderType.WORKFLOW:
            row = WorkflowToolProvider(
                tenant_id="tenant",
                user_id="author",
                name="workflow",
                label="workflow",
                app_id="app",
                version="1",
                description="",
                icon='{"content":"A","background":"#000"}',
            )
        else:
            row = MCPToolProvider(
                tenant_id="tenant",
                user_id="author",
                name="mcp",
                server_identifier=str(uuid4()),
                server_url="encrypted",
                server_url_hash="hash",
                icon='{"content":"A","background":"#000"}',
            )
        session.add(row)
        session.flush()
        references = [row.id]
        if isinstance(row, MCPToolProvider):
            references.append(row.server_identifier)
    for reference in references:
        icon = ToolManager.get_tool_icon("tenant", provider_type, reference, tool_providers=providers)
        assert isinstance(icon, dict)
        assert icon == {"content": "A", "background": "#000"}
        foreign_icon = ToolManager.get_tool_icon("foreign", provider_type, reference, tool_providers=providers)
        assert isinstance(foreign_icon, dict)
        assert foreign_icon["background"] == "#252525"
    assert sessions.kw["bind"].pool.checkedout() == 0


def test_builtin_defaults_are_tenant_scoped_and_ordered(database: Database) -> None:
    sessions, providers = database
    with sessions.begin() as session:
        for tenant, name, default, year in [
            ("tenant", "default", True, 2024),
            ("tenant", "newer", False, 2025),
            ("foreign", "foreign", True, 2026),
        ]:
            row = BuiltinToolProvider(
                tenant_id=tenant, user_id="author", provider="time", name=name, is_default=default
            )
            row.created_at = datetime(year, 1, 1)
            session.add(row)
    assert [p.name for p in providers.default_builtin(tenant_id="tenant")] == ["default"]


def test_list_all_skips_invalid_api_record_and_loads_mcp_author_before_conversion(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions, providers = database
    with sessions.begin() as session:
        session.add(make_account(account_id="author", name="Repository author"))
        invalid = api_provider(name="invalid")
        invalid.tools_str = "invalid-json"
        session.add_all([api_provider(), invalid])
        session.add(
            MCPToolProvider(
                tenant_id="tenant",
                user_id="author",
                name="mcp",
                server_identifier="mcp-server",
                server_url="encrypted",
                server_url_hash="hash",
                icon='{"content":"M","background":"#000"}',
            )
        )
    decrypted: list[str] = []

    def decrypt(tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant"
        assert token == "encrypted"
        assert sessions.kw["bind"].pool.checkedout() == 0
        decrypted.append(token)
        return "https://mcp.example.com"

    def no_builtin_providers(
        _tenant_id: str,
    ) -> Generator[BuiltinToolProviderController | PluginToolProviderController, None, None]:
        yield from ()

    monkeypatch.setattr(ToolManager, "list_builtin_providers", no_builtin_providers)
    monkeypatch.setattr("core.entities.mcp_provider.encrypter.decrypt_token", decrypt)
    result = ToolManager.list_providers_from_api(
        "user", "tenant", None, tool_providers=providers, workflow_queries=WorkflowToolRepository(sessions)
    )
    assert {(p.name, p.author) for p in result} == {("search", "Repository author"), ("mcp", "Repository author")}
    assert decrypted


def test_mcp_creation_reads_author_and_converts_response_after_commit(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.entities.mcp_provider import MCPConfiguration
    from services.tools.mcp_tools_manage_service import MCPToolManageService

    sessions, providers = database
    with sessions.begin() as session:
        session.add(make_account(account_id="author", name="Repository author"))

    def keep_token(_tenant_id: str, text: str) -> str:
        return text

    monkeypatch.setattr("services.tools.mcp_tools_manage_service.encrypter.encrypt_token", keep_token)

    def decrypt(tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant"
        assert sessions.kw["bind"].pool.checkedout() == 0
        return token

    monkeypatch.setattr("core.entities.mcp_provider.encrypter.decrypt_token", decrypt)
    with sessions.begin() as session:
        provider_id = MCPToolManageService(session=session).create_provider(
            tenant_id="tenant",
            user_id="author",
            name="mcp",
            server_url="https://mcp.example.com",
            server_identifier="mcp-server",
            icon="M",
            icon_type="emoji",
            icon_background="#000",
            configuration=MCPConfiguration(),
        )
    result = MCPToolManageService.provider_response(
        tenant_id="tenant", provider_id=provider_id, tool_providers=providers
    )
    assert result.author == "Repository author"
    assert result.id == provider_id
    assert result.tools == []


@pytest.mark.parametrize("provider_type", [ToolProviderType.API, ToolProviderType.WORKFLOW])
def test_label_queries_scope_tenant_type_and_requested_providers(
    database: Database, provider_type: ToolProviderType
) -> None:
    sessions, providers = database
    labels = providers.api_labels if provider_type == "api" else WorkflowToolRepository(sessions).labels
    ids = {name: str(uuid4()) for name in ["selected", "second", "unselected", "unlabeled", "foreign", "missing"]}
    with sessions.begin() as session:
        for name in ["selected", "second", "unselected", "unlabeled", "foreign"]:
            tenant_id = "foreign" if name == "foreign" else "tenant"
            api = api_provider(name=name, tenant_id=tenant_id)
            workflow = WorkflowToolProvider(
                tenant_id=tenant_id,
                user_id="author",
                name=name,
                label=name,
                app_id=str(uuid4()),
                version="1",
                description="",
                icon="icon",
            )
            # IDs can overlap across provider tables. Label type still has to match.
            api.id = workflow.id = ids[name]
            session.add_all([api, workflow])
            if name == "unlabeled":
                continue
            for kind in [ToolProviderType.API, ToolProviderType.WORKFLOW]:
                for label in ["search", "news"]:
                    session.add(ToolLabelBinding(tool_id=ids[name], tool_type=kind, label_name=f"{kind.value}-{label}"))
        session.add(ToolLabelBinding(tool_id=ids["missing"], tool_type=provider_type, label_name="orphan"))
    statements: list[str] = []

    def record_statement(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    event.listen(sessions.kw["bind"], "before_cursor_execute", record_statement)

    assert labels(tenant_id="tenant", provider_ids=[]) == {}
    assert statements == []
    result = labels(tenant_id="tenant", provider_ids=[value for name, value in ids.items() if name != "unselected"])
    assert {provider_id: set(names) for provider_id, names in result.items()} == {
        ids[name]: {f"{provider_type.value}-search", f"{provider_type.value}-news"} for name in ["selected", "second"]
    }
    assert len(statements) == 1
    assert sessions.kw["bind"].pool.checkedout() == 0

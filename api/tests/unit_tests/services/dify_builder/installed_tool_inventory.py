"""Boundary fakes for installed-tool discovery tests (ENG-1191).

Only external I/O is faked: the plugin daemon's pooled HTTP client and the
LLM. Provider declarations travel through the real ``PluginToolManager``
transformer, Pydantic entities, ``ToolManager`` controllers, the tool
catalogue and the Builder resource inventory. Credential rows are real
``tool_builtin_providers`` / ``credential_permissions`` rows in the per-test
SQLite schema.

``forbid_secret_and_business_calls`` turns every owner that could decrypt a
secret, refresh OAuth, validate credentials, invoke a tool or install a
plugin into a recorded failure, so a test can prove discovery never reaches
them.
"""

import copy
import json
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import NoReturn, cast
from urllib.parse import urlsplit

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from models.credential_permission import CredentialPermission
from models.credential_permission import CredentialType as CredentialPermissionType
from models.enums import PermissionEnum
from models.tools import BuiltinToolProvider
from repositories.credentials.query_repository import CredentialQueryRepository

TENANT_ID = "aaaaaaaa-0000-4000-8000-000000000001"
OTHER_TENANT_ID = "aaaaaaaa-0000-4000-8000-000000000002"
ACCOUNT_A = "bbbbbbbb-0000-4000-8000-00000000000a"
ACCOUNT_B = "bbbbbbbb-0000-4000-8000-00000000000b"
ACCOUNT_C = "bbbbbbbb-0000-4000-8000-00000000000c"

SECRET_MARKER = "ENCRYPTED-SECRET-MUST-NOT-BE-READ"


@dataclass(frozen=True)
class FakeTool:
    name: str
    label: str
    description: str = ""


def provider_payload(
    plugin_id: str,
    provider: str,
    tools: Sequence[FakeTool],
    *,
    needs_credentials: bool = False,
    label: str = "",
    description: str = "",
    tags: Sequence[str] = (),
) -> dict[str, object]:
    """One ``management/tools`` item as the daemon serializes it."""
    author = plugin_id.split("/", 1)[0]
    return {
        "provider": provider,
        "plugin_id": plugin_id,
        "plugin_unique_identifier": f"{plugin_id}:0.0.1@{'0' * 64}",
        "declaration": {
            "identity": {
                "author": author,
                "name": provider,
                "label": {"en_US": label or provider},
                "description": {"en_US": description or provider},
                "icon": "icon.svg",
                "tags": list(tags),
            },
            "credentials_schema": (
                [{"name": "api_key", "type": "secret-input", "required": True, "label": {"en_US": "API key"}}]
                if needs_credentials
                else []
            ),
            "tools": [
                {
                    "identity": {
                        "author": author,
                        "name": tool.name,
                        "label": {"en_US": tool.label},
                        "provider": provider,
                    },
                    "description": {"human": {"en_US": tool.description}, "llm": tool.description},
                    "parameters": [],
                }
                for tool in tools
            ],
        },
    }


def filler_providers(count: int, *, prefix: str = "filler") -> list[dict[str, object]]:
    """Ready (credential-free) providers whose names sort before most real ones."""
    return [
        provider_payload(
            f"aaa/{prefix}_{index:03d}",
            f"{prefix}_{index:03d}",
            [FakeTool(name="run", label=f"Filler {index:03d}", description="Generic utility step.")],
        )
        for index in range(count)
    ]


def installation_payload(tenant_id: str, provider: dict[str, object]) -> dict[str, object]:
    """One ``management/installation/fetch/batch`` row for a provider payload.

    Its ``declaration.tool`` is the native ``ToolProviderEntity`` -- the
    provider identity and credential schemas WITHOUT the actions.
    """
    plugin_id = str(provider["plugin_id"])
    author, plugin_name = plugin_id.split("/", 1)
    declaration = provider["declaration"]
    assert isinstance(declaration, dict)
    timestamp = "2026-10-11T00:00:00Z"
    return {
        "id": f"installation-{plugin_name}",
        "created_at": timestamp,
        "updated_at": timestamp,
        "tenant_id": tenant_id,
        "endpoints_setups": 0,
        "endpoints_active": 0,
        "runtime_type": "local",
        "source": "marketplace",
        "meta": {},
        "plugin_id": plugin_id,
        "plugin_unique_identifier": provider["plugin_unique_identifier"],
        "version": "0.0.1",
        "checksum": "0" * 64,
        "declaration": {
            "version": "0.0.1",
            "author": author,
            "name": plugin_name,
            "description": {"en_US": plugin_name},
            "icon": "icon.svg",
            "label": {"en_US": plugin_name},
            "category": "tool",
            "created_at": timestamp,
            "resource": {"memory": 1048576},
            "plugins": {"tools": ["provider.yaml"]},
            "meta": {"version": "0.0.1"},
            "tool": {key: value for key, value in declaration.items() if key != "tools"},
        },
    }


# Public metadata routes the inventory may read (``plugin/{tenant}/management/...``).
LIST_TOOLS = "list_tools"
INSTALLED_IDS = "installed_ids"
INSTALLATION_BATCH = "installation_batch"
SINGLE_TOOL = "single_tool"
METADATA_ROUTES = frozenset({LIST_TOOLS, INSTALLED_IDS, INSTALLATION_BATCH, SINGLE_TOOL})


@dataclass
class DaemonRequest:
    """One recorded request: route, tenant and public query/body -- never headers."""

    method: str
    path: str
    params: dict[str, object]
    route: str = ""
    tenant_id: str = ""
    body: dict[str, object] | None = None


def _route(method: str, parts: list[str]) -> str:
    if method == "GET" and parts[-2:] == ["management", "tools"]:
        return LIST_TOOLS
    if method == "GET" and parts[-3:] == ["management", "installation", "ids"]:
        return INSTALLED_IDS
    if method == "POST" and parts[-4:] == ["management", "installation", "fetch", "batch"]:
        return INSTALLATION_BATCH
    if method == "GET" and parts[-2:] == ["management", "tool"]:
        return SINGLE_TOOL
    return ""


def _tenant(parts: list[str]) -> str:
    return parts[parts.index("plugin") + 1] if "plugin" in parts and parts.index("plugin") + 1 < len(parts) else ""


@dataclass
class FakeToolDaemon:
    """Stands in for the pooled httpx client used by ``BasePluginClient``.

    Serves the plugin daemon's public tool-metadata routes for each tenant:

    - ``GET management/tools``: ``ListTools`` page/page_size contract (tenant
      filter, ``db.Page``); ``list_tools_pages`` replaces the pages with an
      explicit (e.g. legally unordered) sequence.
    - ``GET management/installation/ids?category=tool``: the installed Tool
      plugin IDs, derived from ``providers_by_tenant`` unless
      ``installed_ids_by_tenant`` / ``installed_ids_sequence`` override them.
    - ``POST management/installation/fetch/batch``: installation rows for the
      requested IDs (native ``max=256``); ``batch_rows_hook`` may corrupt them.
    - ``GET management/tool?plugin_id&provider``: one provider with actions;
      ``single_payload_hook`` may corrupt it.

    ``fail_routes`` answer HTTP 500 and ``malformed_routes`` an unparsable
    body. Every other path is recorded and answered with HTTP 500.
    """

    providers_by_tenant: dict[str, list[dict[str, object]]] = field(default_factory=dict)
    fail_on_page: int | None = None
    fail_all: bool = False
    ignore_page: bool = False
    endless_unique_pages: bool = False
    list_tools_pages: dict[int, list[dict[str, object]]] | None = None
    installed_ids_by_tenant: dict[str, list[str]] | None = None
    installed_ids_sequence: list[list[str]] | None = None
    fail_routes: frozenset[str] = frozenset()
    malformed_routes: frozenset[str] = frozenset()
    batch_rows_hook: Callable[[list[dict[str, object]], list[str]], list[dict[str, object]]] | None = None
    single_payload_hook: Callable[[dict[str, object]], dict[str, object]] | None = None
    requests: list[DaemonRequest] = field(default_factory=list)
    max_requests: int = 1000

    def request(
        self,
        *,
        method: str,
        url: str,
        params: dict[str, object] | None = None,
        content: str | bytes | None = None,
        data: dict[str, object] | None = None,
        **_kwargs: object,
    ) -> httpx.Response:
        path = urlsplit(url).path
        params = dict(params or {})
        parts = [part for part in path.split("/") if part]
        route = _route(method, parts)
        tenant_id = _tenant(parts)
        body = json.loads(content) if content else (dict(data) if data else None)
        self.requests.append(
            DaemonRequest(method=method, path=path, params=params, route=route, tenant_id=tenant_id, body=body)
        )
        if len(self.requests) > self.max_requests:
            raise AssertionError("plugin inventory paging did not terminate")
        http_request = httpx.Request(method, url)

        def respond(status: int, payload: object) -> httpx.Response:
            return httpx.Response(status, json=payload, request=http_request)

        if not route or self.fail_all or route in self.fail_routes:
            return respond(500, {"code": -500, "message": "unavailable"})
        if route in self.malformed_routes:
            return respond(200, {"code": 0, "message": "", "data": {"unexpected": True}})
        providers = self.providers_by_tenant.get(tenant_id, [])
        if route == LIST_TOOLS:
            return self._list_tools(respond, params, providers)
        if route == INSTALLED_IDS:
            if params.get("category") != "tool":
                return respond(400, {"code": -400, "message": "bad category"})
            return respond(200, {"code": 0, "message": "", "data": {"plugin_ids": self._installed_ids(tenant_id)}})
        if route == INSTALLATION_BATCH:
            plugin_ids = [str(plugin_id) for plugin_id in cast(list[object], (body or {}).get("plugin_ids") or [])]
            if len(plugin_ids) > 256:
                return respond(400, {"code": -400, "message": "plugin_ids exceeds max=256"})
            rows = [installation_payload(tenant_id, p) for p in providers if p["plugin_id"] in plugin_ids]
            if self.batch_rows_hook is not None:
                rows = self.batch_rows_hook(rows, plugin_ids)
            return respond(200, {"code": 0, "message": "", "data": rows})
        # SINGLE_TOOL
        match = next(
            (
                p
                for p in providers
                if p["plugin_id"] == params.get("plugin_id")
                and isinstance(p["declaration"], dict)
                and p["declaration"]["identity"]["name"] == params.get("provider")
            ),
            None,
        )
        if match is None:
            return respond(404, {"code": -404, "message": "plugin not found"})
        payload = copy.deepcopy(match)
        if self.single_payload_hook is not None:
            payload = self.single_payload_hook(payload)
        return respond(200, {"code": 0, "message": "", "data": payload})

    def _list_tools(
        self,
        respond: Callable[[int, object], httpx.Response],
        params: dict[str, object],
        providers: list[dict[str, object]],
    ) -> httpx.Response:
        page = int(str(params.get("page", 0)))
        page_size = int(str(params.get("page_size", 0)))
        if page < 1 or not 1 <= page_size <= 256:
            return respond(400, {"code": -400, "message": "bad paging"})
        if self.fail_on_page == page:
            return respond(500, {"code": -500, "message": "page failed"})
        if self.endless_unique_pages:
            data = filler_providers(page_size, prefix=f"endless_p{page}")
        elif self.list_tools_pages is not None:
            data = self.list_tools_pages.get(page, [])
        else:
            effective_page = 1 if self.ignore_page else page
            data = providers[(effective_page - 1) * page_size : effective_page * page_size]
        return respond(200, {"code": 0, "message": "", "data": data})

    def _installed_ids(self, tenant_id: str) -> list[str]:
        if self.installed_ids_sequence:
            return self.installed_ids_sequence.pop(0)
        if self.installed_ids_by_tenant is not None:
            return list(self.installed_ids_by_tenant.get(tenant_id, []))
        return [str(p["plugin_id"]) for p in self.providers_by_tenant.get(tenant_id, [])]

    def list_tools_requests(self) -> list[DaemonRequest]:
        return [r for r in self.requests if r.path.endswith("/management/tools")]

    def requests_for(self, route: str) -> list[DaemonRequest]:
        return [r for r in self.requests if r.route == route]


def install_fake_daemon(monkeypatch: pytest.MonkeyPatch, daemon: FakeToolDaemon) -> FakeToolDaemon:
    import core.plugin.impl.base as plugin_base

    monkeypatch.setattr(plugin_base, "_httpx_client", daemon)
    return daemon


def bind_database(monkeypatch: pytest.MonkeyPatch, engine: Engine) -> None:
    """Point inventory database handles and its credential query owner at SQLite."""
    import core.tools.tool_manager as tool_manager_module
    from services.dify_builder.agent import resources

    database = SimpleNamespace(engine=engine)
    monkeypatch.setattr(resources, "db", database, raising=False)
    credential_queries = CredentialQueryRepository(session_factory=sessionmaker(bind=engine, expire_on_commit=False))
    monkeypatch.setattr(
        resources, "application_services", lambda: SimpleNamespace(credential_queries=credential_queries)
    )
    monkeypatch.setattr(tool_manager_module, "db", database)


def add_credential(
    session: Session,
    *,
    tenant_id: str,
    provider: str,
    user_id: str,
    visibility: PermissionEnum = PermissionEnum.ALL_TEAM,
    partial_members: Iterable[str] = (),
    name: str = "API KEY 1",
) -> BuiltinToolProvider:
    row = BuiltinToolProvider(
        tenant_id=tenant_id,
        user_id=user_id,
        provider=provider,
        name=name,
        encrypted_credentials='{"api_key": "' + SECRET_MARKER + '"}',
        is_default=True,
        credential_type=CredentialType.API_KEY,
        expires_at=-1,
        visibility=visibility,
    )
    session.add(row)
    session.flush()
    for account_id in partial_members:
        session.add(
            CredentialPermission(
                credential_id=row.id,
                credential_type=CredentialPermissionType.BUILTIN_TOOL_PROVIDER,
                account_id=account_id,
                tenant_id=tenant_id,
            )
        )
    session.commit()
    return row


def record_sql(engine: Engine) -> list[str]:
    statements: list[str] = []

    def _before(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _before)
    return statements


def forbid_secret_and_business_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record (and fail) any call into a secret, OAuth, invoke, validate or install owner."""
    from core.helper import provider_encryption
    from core.plugin.impl.oauth import OAuthHandler
    from core.plugin.impl.plugin import PluginInstaller
    from core.plugin.impl.tool import PluginToolManager
    from core.tools.tool_manager import ToolManager
    from services.tools.builtin_tools_manage_service import BuiltinToolManageService

    calls: list[str] = []

    def _forbidden(name: str) -> Callable[..., NoReturn]:
        def _raise(*_args: object, **_kwargs: object) -> NoReturn:
            calls.append(name)
            raise AssertionError(f"discovery must not call {name}")

        return _raise

    targets: list[tuple[object, str]] = [
        (provider_encryption.ProviderConfigEncrypter, "decrypt"),
        (provider_encryption, "create_provider_encrypter"),
        (OAuthHandler, "refresh_credentials"),
        (PluginToolManager, "invoke"),
        (PluginToolManager, "validate_provider_credentials"),
        (PluginToolManager, "get_runtime_parameters"),
        (PluginInstaller, "install_from_identifiers"),
        (BuiltinToolManageService, "get_builtin_tool_provider_credentials"),
        (ToolManager, "get_tool_runtime"),
    ]
    for owner, attribute in targets:
        monkeypatch.setattr(owner, attribute, _forbidden(f"{getattr(owner, '__name__', owner)}.{attribute}"))
    import core.tools.tool_manager as tool_manager_module

    for attribute in ("create_provider_encrypter", "create_tool_provider_encrypter"):
        monkeypatch.setattr(tool_manager_module, attribute, _forbidden(f"tool_manager.{attribute}"))
    return calls

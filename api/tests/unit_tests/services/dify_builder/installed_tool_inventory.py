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

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from models.credential_permission import CredentialPermission
from models.credential_permission import CredentialType as CredentialPermissionType
from models.enums import PermissionEnum
from models.tools import BuiltinToolProvider

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


@dataclass
class DaemonRequest:
    method: str
    path: str
    params: dict[str, object]


@dataclass
class FakeToolDaemon:
    """Stands in for the pooled httpx client used by ``BasePluginClient``.

    Serves ``GET plugin/{tenant}/management/tools`` with the page/page_size
    contract of the daemon's ``ListTools`` (tenant filter, ``db.Page``).
    Every other path is recorded and answered with HTTP 500.
    """

    providers_by_tenant: dict[str, list[dict[str, object]]] = field(default_factory=dict)
    fail_on_page: int | None = None
    fail_all: bool = False
    ignore_page: bool = False
    endless_unique_pages: bool = False
    requests: list[DaemonRequest] = field(default_factory=list)
    max_requests: int = 1000

    def request(self, *, method: str, url: str, params: dict[str, object] | None = None, **_kwargs: object):
        path = urlsplit(url).path
        params = dict(params or {})
        self.requests.append(DaemonRequest(method=method, path=path, params=params))
        if len(self.requests) > self.max_requests:
            raise AssertionError("plugin inventory paging did not terminate")
        http_request = httpx.Request(method, url)
        parts = [part for part in path.split("/") if part]
        is_list_tools = method == "GET" and len(parts) >= 3 and parts[-2:] == ["management", "tools"]
        if not is_list_tools or self.fail_all:
            return httpx.Response(500, json={"code": -500, "message": "unavailable"}, request=http_request)
        tenant_id = parts[-3]
        page = int(params.get("page", 0))
        page_size = int(params.get("page_size", 0))
        if page < 1 or not 1 <= page_size <= 256:
            return httpx.Response(400, json={"code": -400, "message": "bad paging"}, request=http_request)
        if self.fail_on_page == page:
            return httpx.Response(500, json={"code": -500, "message": "page failed"}, request=http_request)
        if self.endless_unique_pages:
            data = filler_providers(page_size, prefix=f"endless_p{page}")
        else:
            providers = self.providers_by_tenant.get(tenant_id, [])
            effective_page = 1 if self.ignore_page else page
            data = providers[(effective_page - 1) * page_size : effective_page * page_size]
        return httpx.Response(200, json={"code": 0, "message": "", "data": data}, request=http_request)

    def list_tools_requests(self) -> list[DaemonRequest]:
        return [r for r in self.requests if r.path.endswith("/management/tools")]


def install_fake_daemon(monkeypatch: pytest.MonkeyPatch, daemon: FakeToolDaemon) -> FakeToolDaemon:
    import core.plugin.impl.base as plugin_base

    monkeypatch.setattr(plugin_base, "_httpx_client", daemon)
    return daemon


def bind_database(monkeypatch: pytest.MonkeyPatch, engine: Engine) -> None:
    """Point the module-level ``db`` handles of the inventory owners at SQLite."""
    import core.tools.tool_manager as tool_manager_module
    from services.dify_builder.agent import resources

    database = SimpleNamespace(engine=engine)
    monkeypatch.setattr(resources, "db", database, raising=False)
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

    def _before(_conn, _cursor, statement, _parameters, _context, _executemany):
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

    def _forbidden(name: str):
        def _raise(*_args: object, **_kwargs: object):
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

import uuid
from collections.abc import Callable

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import TokenType
from controllers.common.fields import SimpleResultResponse
from controllers.openapi import tool_providers
from controllers.openapi._errors import CredentialNotFound
from controllers.openapi._models import PageQuery, ToolListQuery, ToolListResponse
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.tool_providers import ToolProviderCredentialApi, _credential_write_errors, tool_rows
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool import ToolParameter
from core.tools.entities.api_entities import (
    ToolApiEntity,
    ToolProviderApiEntity,
    ToolProviderCredentialApiEntity,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import AuthContext
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from tests.helpers.unit.model_factories import make_account, make_tenant


@pytest.mark.parametrize(
    "message",
    [
        "the credential name 'main' is already used",
        "you have reached the maximum number of providers for tavily",
        "provider tavily does not need credentials",
    ],
)
def test_other_failures_are_bad_request_with_the_service_message(message: str) -> None:
    with pytest.raises(BadRequest, match=message):
        with _credential_write_errors():
            raise ValueError(message)


Form = ToolParameter.ToolParameterForm
ParamType = ToolParameter.ToolParameterType


def _param(
    name: str, form: ToolParameter.ToolParameterForm, *, default: str | None = None, required: bool = False
) -> ToolParameter:
    return ToolParameter(
        name=name, label=I18nObject(en_US=name), type=ParamType.STRING, form=form, default=default, required=required
    )


def _tool(name: str, parameters: list[ToolParameter] | None, label: str | None = None) -> ToolApiEntity:
    return ToolApiEntity(
        author="a",
        name=name,
        label=I18nObject(en_US=label if label is not None else name.title()),
        description=I18nObject(en_US=f"{name} tool"),
        parameters=parameters,
    )


def _provider(
    pid: str,
    kind: ToolProviderType,
    tools: list[ToolApiEntity],
    *,
    plugin_id: str = "",
    plugin_unique_identifier: str = "",
    server_identifier: str = "",
    is_team_authorization: bool = True,
) -> ToolProviderApiEntity:
    return ToolProviderApiEntity(
        id=pid,
        author="a",
        name=pid,
        description=I18nObject(en_US=pid),
        icon="",
        label=I18nObject(en_US=pid.split("/")[-1].title()),
        type=kind,
        tools=tools,
        plugin_id=plugin_id,
        plugin_unique_identifier=plugin_unique_identifier,
        server_identifier=server_identifier,
        is_team_authorization=is_team_authorization,
    )


GITHUB = _provider(
    "langgenius/github/github",
    ToolProviderType.BUILT_IN,
    [
        _tool(
            "get_issues",
            [
                _param("repo", Form.LLM, required=True),
                _param("state", Form.FORM, default="open"),
                _param("spec", Form.SCHEMA),
            ],
        )
    ],
    plugin_id="langgenius/github",
    plugin_unique_identifier="langgenius/github:0.1.0@abc",
    is_team_authorization=False,
)


def test_parameters_split_by_form() -> None:
    [row] = tool_rows([GITHUB], words="", provider=None, language=None)
    data = row.node_data
    assert {k: (v.type, v.value) for k, v in data.tool_parameters.items()} == {"repo": ("constant", None)}
    assert {k: (v.type, v.value) for k, v in data.tool_configurations.items()} == {"state": ("constant", "open")}
    assert [p.name for p in row.parameters] == ["repo", "state", "spec"]
    assert data.tool_node_version == "2"
    assert (data.plugin_id, data.plugin_unique_identifier) == ("langgenius/github", "langgenius/github:0.1.0@abc")
    assert (data.provider_id, data.provider_name, data.provider_type) == (
        "langgenius/github/github",
        "langgenius/github/github",
        "builtin",
    )
    assert row.configured is False


def test_mcp_provider_id_is_the_server_identifier_and_no_plugin_fields() -> None:
    mcp = _provider("uuid-1", ToolProviderType.MCP, [_tool("search", [])], server_identifier="my-server")
    [row] = tool_rows([mcp], words="", provider=None, language=None)
    assert row.node_data.provider_id == "my-server"
    assert row.node_data.plugin_id is None
    assert row.node_data.plugin_unique_identifier is None


def test_tool_without_parameters() -> None:
    wf = _provider("wf-uuid", ToolProviderType.WORKFLOW, [_tool("summarize", None)])
    [row] = tool_rows([wf], words="", provider=None, language=None)
    assert row.parameters == []
    assert row.node_data.tool_parameters == {}
    assert row.node_data.tool_configurations == {}
    assert row.node_data.tool_name == "summarize"


def test_label_falls_back_to_name() -> None:
    p = _provider("x/y/z", ToolProviderType.API, [_tool("ping", [], label="")])
    [row] = tool_rows([p], words="", provider=None, language=None)
    assert row.label == "ping"
    assert row.node_data.title == "ping"
    assert row.node_data.tool_label == "ping"


def test_rows_are_flattened_sorted_and_filtered() -> None:
    other = _provider("acme/slack/slack", ToolProviderType.BUILT_IN, [_tool("send", []), _tool("list", [])])
    rows = tool_rows([GITHUB, other], words="", provider=None, language=None)
    assert [(r.provider, r.name) for r in rows] == [
        ("acme/slack/slack", "list"),
        ("acme/slack/slack", "send"),
        ("langgenius/github/github", "get_issues"),
    ]
    assert [r.name for r in tool_rows([GITHUB, other], words="GITHUB", provider=None, language=None)] == ["get_issues"]
    assert [r.name for r in tool_rows([GITHUB, other], words="", provider="acme/slack/slack", language=None)] == [
        "list",
        "send",
    ]
    assert tool_rows([GITHUB, other], words="", provider="no/such/provider", language=None) == []


def test_page_past_the_end() -> None:
    rows = tool_rows([GITHUB], words="", provider=None, language=None)
    page = ToolListResponse.page_of(rows, query=PageQuery(page=99, limit=20))
    assert (page.data, page.total, page.has_more) == ([], 1, False)


def test_unknown_provider_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ToolListQuery.model_validate({"provider_type": "plugin"})


_PROVIDER = "langgenius/tavily/tavily"


def _context(session: Session) -> Context:
    subject = AccountSubject(
        AuthContext(
            subject_email="caller@example.com",
            subject_issuer="dify:account",
            account_id=uuid.uuid4(),
            client_id="difyctl",
            token_id=uuid.uuid4(),
            token_type=TokenType.OAUTH_ACCOUNT,
            expires_at=None,
        )
    )
    ctx = Context(subject, session, {"workspace_id": "ws"})
    ctx._workspace = make_tenant(tenant_id="ws")
    ctx._caller = make_account(interface_language="en-US")
    return ctx


def _credential(credential_id: str) -> ToolProviderCredentialApiEntity:
    return ToolProviderCredentialApiEntity(
        id=credential_id, name="main", provider=_PROVIDER, credential_type=CredentialType.API_KEY
    )


def _handler(view: Callable[..., object]) -> Callable[..., object]:
    """Return the bare view ``@endpoint`` attaches as ``__handler__``."""
    handler = vars(view).get("__handler__")
    assert callable(handler)
    return handler


def test_delete_removes_a_visible_credential(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    deleted: list[tuple[str, str, str]] = []

    def credentials(**_kwargs: object) -> list[ToolProviderCredentialApiEntity]:
        return [_credential("cred-1")]

    def delete(tenant_id: str, provider: str, credential_id: str) -> dict[str, str]:
        deleted.append((tenant_id, provider, credential_id))
        return {"result": "success"}

    monkeypatch.setattr(BuiltinToolManageService, "get_builtin_tool_provider_credentials", credentials)
    monkeypatch.setattr(BuiltinToolManageService, "delete_builtin_tool_provider", delete)
    monkeypatch.setattr(tool_providers, "application_services", lambda: account_application_services)

    api = ToolProviderCredentialApi()
    with app.test_request_context(
        f"/openapi/v1/workspaces/ws/tool-providers/{_PROVIDER}/credentials/cred-1", method="DELETE"
    ):
        result = _handler(api.delete)(api, _context(sqlite_session), "ws", _PROVIDER, "cred-1")

    assert result == SimpleResultResponse(result="success")
    assert deleted == [("ws", _PROVIDER, "cred-1")]


def test_delete_answers_404_for_a_credential_the_list_does_not_show(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    deleted: list[object] = []

    def delete(*_args: object) -> dict[str, str]:
        deleted.append(None)
        return {"result": "success"}

    monkeypatch.setattr(
        BuiltinToolManageService,
        "get_builtin_tool_provider_credentials",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(BuiltinToolManageService, "delete_builtin_tool_provider", delete)
    monkeypatch.setattr(tool_providers, "application_services", lambda: account_application_services)

    api = ToolProviderCredentialApi()
    with (
        app.test_request_context(
            f"/openapi/v1/workspaces/ws/tool-providers/{_PROVIDER}/credentials/missing", method="DELETE"
        ),
        pytest.raises(CredentialNotFound),
    ):
        _handler(api.delete)(api, _context(sqlite_session), "ws", _PROVIDER, "missing")

    assert deleted == []

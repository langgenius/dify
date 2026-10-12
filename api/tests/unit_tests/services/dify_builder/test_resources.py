import logging
from collections.abc import Sequence
from unittest.mock import patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    ACCOUNT_C,
    METADATA_ROUTES,
    OTHER_TENANT_ID,
    SECRET_MARKER,
    TENANT_ID,
    FakeTool,
    FakeToolDaemon,
    add_credential,
    bind_database,
    forbid_secret_and_business_calls,
    install_fake_daemon,
    provider_payload,
    record_sql,
)


def test_list_tenant_resources_normalizes_all_three_kinds() -> None:
    from services.dify_builder.agent import resources

    class _Model:
        def __init__(self, m: str) -> None:
            self.model = m

    class _ProvResp:
        def __init__(self, p: str, ms: list[str]) -> None:
            self.provider, self.models = p, [_Model(m) for m in ms]

    class _DS:
        def __init__(self, i: str, n: str) -> None:
            self.id, self.name = i, n

    tool_record = {
        "provider_name": "google",
        "tool_name": "search",
        "tool_label": "Google Search",
        "description": "",
    }
    with (
        patch.object(resources, "_list_models", return_value=[_ProvResp("anthropic", ["claude-opus-4-8"])]),
        patch.object(resources, "_list_datasets", return_value=[_DS("kb-1", "Company KB")]),
        patch.object(resources, "_list_tools", return_value=[tool_record]),
    ):
        out = resources.list_tenant_resources("t1")

    assert out.models[0].id == "anthropic/claude-opus-4-8"
    assert out.datasets[0].id == "kb-1"
    assert out.datasets[0].label == "Company KB"
    assert out.tools[0].id == "google/search"
    assert out.tools[0].label == "Google Search"


def test_each_source_degrades_to_empty() -> None:
    from services.dify_builder.agent import resources

    with (
        patch.object(resources, "_list_models", side_effect=RuntimeError("boom")),
        patch.object(resources, "_list_datasets", side_effect=RuntimeError("boom")),
        patch.object(resources, "_list_tools", side_effect=RuntimeError("boom")),
    ):
        out = resources.list_tenant_resources("t1")
    assert out == resources.TenantResources(models=[], datasets=[], tools=[])


def test_mixed_failure_partial_success() -> None:
    from services.dify_builder.agent import resources

    class _DS:
        def __init__(self, i: str, n: str) -> None:
            self.id, self.name = i, n

    tool_record = {
        "provider_name": "google",
        "tool_name": "search",
        "tool_label": "Google Search",
        "description": "",
    }
    with (
        patch.object(resources, "_list_models", side_effect=RuntimeError("boom")),
        patch.object(resources, "_list_datasets", return_value=[_DS("kb-1", "Company KB")]),
        patch.object(resources, "_list_tools", return_value=[tool_record]),
    ):
        out = resources.list_tenant_resources("t1")

    assert out.models == []
    assert len(out.datasets) == 1
    assert out.datasets[0].id == "kb-1"
    assert len(out.tools) == 1
    assert out.tools[0].id == "google/search"


def test_malformed_tool_record_degrades() -> None:
    from services.dify_builder.agent import resources

    with (
        patch.object(resources, "_list_models", return_value=[]),
        patch.object(resources, "_list_datasets", return_value=[]),
        patch.object(resources, "_list_tools", return_value=[{"provider_name": "g"}]),
    ):  # missing tool_name
        out = resources.list_tenant_resources("t1")

    assert out.tools == []
    assert out.models == []
    assert out.datasets == []


def test_an_unauthorized_tool_is_reported_as_missing_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """Recommending an unusable tool is how a build fails at test time."""
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "gmail",
                "tool_name": "send",
                "tool_label": "Send",
                "description": "",
                "needs_credentials": True,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda *_args, **_kwargs: set())
    inv = resources.list_tenant_resources("t1")
    assert inv.tools[0].readiness == "missing_config"


def test_a_tool_needing_no_credentials_is_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "time",
                "tool_name": "now",
                "tool_label": "Now",
                "description": "",
                "needs_credentials": False,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda *_args, **_kwargs: set())
    assert resources.list_tenant_resources("t1").tools[0].readiness == "ready"


def test_an_authorized_tool_is_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import resources

    monkeypatch.setattr(
        resources,
        "_list_tools",
        lambda _t: [
            {
                "provider_name": "gmail",
                "tool_name": "send",
                "tool_label": "Send",
                "description": "",
                "needs_credentials": True,
            }
        ],
    )
    monkeypatch.setattr(resources, "_authorized_providers", lambda *_args, **_kwargs: {"gmail"})
    assert resources.list_tenant_resources("t1").tools[0].readiness == "ready"


def test_authorization_lookup_failure_is_never_reported_ready(caplog: pytest.LogCaptureFixture) -> None:
    """ENG-1191 ruling: an unverified credential lookup must not claim a tool
    is usable. The tool stays discoverable as missing_config with an
    explanatory note; runtime authorization remains the final gate."""
    from services.dify_builder.agent import resources

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("db down")

    with (
        patch.object(resources, "_list_models", return_value=[]),
        patch.object(resources, "_list_datasets", return_value=[]),
        patch.object(
            resources,
            "_list_tools",
            return_value=[
                {
                    "provider_name": "gmail",
                    "tool_name": "send",
                    "tool_label": "Send",
                    "description": "Send an email.",
                    "needs_credentials": True,
                },
                {
                    "provider_name": "time",
                    "tool_name": "now",
                    "tool_label": "Now",
                    "description": "",
                    "needs_credentials": False,
                },
            ],
        ),
        patch.object(resources, "_authorized_providers", _boom),
        caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.resources"),
    ):
        out = resources.list_tenant_resources("t1")

    by_id = {tool.id: tool for tool in out.tools}
    assert by_id["gmail/send"].readiness == "missing_config"
    assert "could not be verified" in by_id["gmail/send"].meta
    assert "Send an email." in by_id["gmail/send"].meta
    # a credential-free tool needs no lookup to be usable
    assert by_id["time/now"].readiness == "ready"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "authorization" in warnings[0].getMessage()


def test_list_tenant_resources_logs_when_a_source_fails(caplog: pytest.LogCaptureFixture) -> None:
    from services.dify_builder.agent import resources

    class _Model:
        def __init__(self, m: str) -> None:
            self.model = m

    class _ProvResp:
        def __init__(self, p: str, ms: list[str]) -> None:
            self.provider, self.models = p, [_Model(m) for m in ms]

    with (
        patch.object(resources, "_list_models", return_value=[_ProvResp("anthropic", ["claude-opus-4-8"])]),
        patch.object(resources, "_list_datasets", side_effect=RuntimeError("db down")),
        patch.object(resources, "_list_tools", return_value=[]),
        caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.resources"),
    ):
        out = resources.list_tenant_resources("t1")

    assert out.datasets == []
    assert out.models[0].id == "anthropic/claude-opus-4-8"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "datasets" in warnings[0].getMessage()
    assert warnings[0].exc_info is not None


# ---- ENG-1191: real installed inventory, real credential rows ----------------
#
# Daemon I/O is the only fake: providers flow through PluginToolManager,
# ToolManager and build_tool_catalogue; credential readiness is computed from
# real tool_builtin_providers / credential_permissions rows in SQLite.


_HUDDLE = "acme/huddle/huddle"


def _tenant_providers() -> list[dict[str, object]]:
    def creds(
        plugin_id: str,
        provider: str,
        tool: FakeTool,
        *,
        label: str = "",
        description: str = "",
        tags: Sequence[str] = (),
    ) -> dict[str, object]:
        return provider_payload(
            plugin_id,
            provider,
            [tool],
            needs_credentials=True,
            label=label,
            description=description,
            tags=tags,
        )

    return [
        creds(
            "acme/huddle",
            "huddle",
            FakeTool(name="post", label="Post", description="Send text to a channel."),
            label="Huddle",
            description="Notify teammates in shared chat channels.",
            tags=["social"],
        ),
        creds("acme/vault", "vault", FakeTool(name="lookup", label="Lookup", description="Read a record.")),
        creds("acme/onlyme", "onlyme", FakeTool(name="run", label="Run", description="Private tool.")),
        creds("acme/partial", "partial", FakeTool(name="run", label="Run", description="Shared with some.")),
        creds("langgenius/google", "google", FakeTool(name="search", label="Search", description="Web search.")),
        creds("acme/google", "google", FakeTool(name="search", label="Search", description="Acme search.")),
        creds("langgenius/jina_tool", "jina", FakeTool(name="read", label="Read", description="Read a URL.")),
        provider_payload("acme/free", "free", [FakeTool(name="echo", label="Echo", description="Echo input.")]),
    ]


@pytest.fixture
def installed(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> tuple[FakeToolDaemon, list[str]]:
    """Real inventory owners over a faked daemon and real SQLite credential rows."""
    bind_database(monkeypatch, sqlite_engine)
    daemon = install_fake_daemon(
        monkeypatch,
        FakeToolDaemon(
            providers_by_tenant={
                TENANT_ID: _tenant_providers(),
                OTHER_TENANT_ID: [
                    provider_payload(
                        "other/elsewhere", "elsewhere", [FakeTool(name="go", label="Go", description="Other tenant.")]
                    )
                ],
            }
        ),
    )
    from services.dify_builder.agent import resources

    # models/datasets come from their own owners; this suite is about tools
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])
    forbidden = forbid_secret_and_business_calls(monkeypatch)
    return daemon, forbidden


def _readiness(tenant_id: str = TENANT_ID, *, account_id: str | None = None) -> dict[str, str]:
    from services.dify_builder.agent import resources

    return {tool.id: tool.readiness for tool in resources.list_tenant_resources(tenant_id, account_id=account_id).tools}


def test_installed_unauthenticated_tool_is_discoverable_as_missing_config(
    installed: tuple[FakeToolDaemon, list[str]], sqlite_engine: Engine
) -> None:
    from services.dify_builder.agent import resources

    daemon, forbidden = installed
    statements = record_sql(sqlite_engine)

    tools = {tool.id: tool for tool in resources.list_tenant_resources(TENANT_ID).tools}

    huddle = tools[f"{_HUDDLE}/post"]
    assert huddle.readiness == "missing_config"
    assert "Send text to a channel." in huddle.meta
    assert "requires setup" in huddle.meta
    # discovery reads metadata only: no secret, OAuth, validate, invoke or
    # install owner, no daemon call besides the tool listing, and no SQL
    # statement that selects the encrypted credential column
    assert forbidden == []
    assert daemon.requests
    # only public tool-metadata routes, for this tenant
    assert all(r.route in METADATA_ROUTES and r.tenant_id == TENANT_ID for r in daemon.requests)
    assert not [s for s in statements if "encrypted_credentials" in s]
    assert not [s for s in statements if SECRET_MARKER in s]


@pytest.mark.usefixtures("installed")
def test_configured_no_auth_and_hardcoded_tools_are_ready(sqlite_session: Session) -> None:
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider="acme/vault/vault", user_id=ACCOUNT_B)

    readiness = _readiness()

    assert readiness["acme/vault/vault/lookup"] == "ready"
    assert readiness["acme/free/free/echo"] == "ready"
    assert readiness["time/current_time"] == "ready"
    assert readiness[f"{_HUDDLE}/post"] == "missing_config"


@pytest.mark.parametrize(
    ("account_id", "provider", "expected"),
    [
        (ACCOUNT_A, "acme/onlyme/onlyme", "missing_config"),  # teammate's private credential
        (ACCOUNT_B, "acme/onlyme/onlyme", "ready"),  # the creator's own
        (ACCOUNT_A, "acme/partial/partial", "ready"),  # listed partial member
        (ACCOUNT_C, "acme/partial/partial", "missing_config"),  # not a member
        (ACCOUNT_B, "acme/partial/partial", "ready"),  # creator
        (ACCOUNT_C, "acme/vault/vault", "ready"),  # all-team
    ],
)
@pytest.mark.usefixtures("installed")
def test_credential_visibility_follows_the_acting_account(
    sqlite_session: Session, account_id: str, provider: str, expected: str
) -> None:
    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/onlyme/onlyme",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/partial/partial",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.PARTIAL_TEAM,
        partial_members=[ACCOUNT_A],
    )
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider="acme/vault/vault", user_id=ACCOUNT_B)

    readiness = _readiness(account_id=account_id)

    tool_name = "lookup" if provider == "acme/vault/vault" else "run"
    assert readiness[f"{provider}/{tool_name}"] == expected


@pytest.mark.usefixtures("installed")
def test_without_an_actor_only_team_shared_credentials_count(sqlite_session: Session) -> None:
    """A compatibility caller with no actor must not borrow a teammate's
    private or partial credential to claim readiness."""
    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/onlyme/onlyme",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/partial/partial",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.PARTIAL_TEAM,
        partial_members=[ACCOUNT_A],
    )
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider="acme/vault/vault", user_id=ACCOUNT_B)

    readiness = _readiness()

    assert readiness["acme/onlyme/onlyme/run"] == "missing_config"
    assert readiness["acme/partial/partial/run"] == "missing_config"
    assert readiness["acme/vault/vault/lookup"] == "ready"


@pytest.mark.parametrize("invalid_grant", ["disabled", "foreign-tenant", "wrong-type"])
@pytest.mark.usefixtures("installed")
def test_invalid_partial_grants_do_not_make_a_tool_ready(sqlite_session: Session, invalid_grant: str) -> None:
    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider="acme/partial/partial",
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.PARTIAL_TEAM,
        partial_members=[ACCOUNT_A],
    )
    grant = sqlite_session.scalar(
        select(CredentialPermission).where(CredentialPermission.credential_id == credential.id)
    )
    assert grant is not None
    if invalid_grant == "disabled":
        grant.has_permission = False
    elif invalid_grant == "foreign-tenant":
        grant.tenant_id = OTHER_TENANT_ID
    else:
        grant.credential_type = CredentialType.PROVIDER_CREDENTIAL
    sqlite_session.commit()

    assert _readiness(account_id=ACCOUNT_A)["acme/partial/partial/run"] == "missing_config"


@pytest.mark.parametrize(
    ("row_provider", "ready_ids", "missing_ids"),
    [
        # legacy short id normalizes to the langgenius plugin only
        ("google", {"langgenius/google/google/search"}, {"acme/google/google/search"}),
        # a same-short-name plugin from another org never borrows it
        ("acme/google/google", {"acme/google/google/search"}, {"langgenius/google/google/search"}),
        ("langgenius/google/google", {"langgenius/google/google/search"}, {"acme/google/google/search"}),
        # native ToolProviderID remap: jina -> langgenius/jina_tool/jina
        ("jina", {"langgenius/jina_tool/jina/read"}, set()),
    ],
)
@pytest.mark.usefixtures("installed")
def test_legacy_and_colliding_provider_ids_follow_native_normalization(
    sqlite_session: Session, row_provider: str, ready_ids: set[str], missing_ids: set[str]
) -> None:
    add_credential(sqlite_session, tenant_id=TENANT_ID, provider=row_provider, user_id=ACCOUNT_B)

    readiness = _readiness()

    assert {tool_id: readiness[tool_id] for tool_id in ready_ids} == dict.fromkeys(ready_ids, "ready")
    assert {tool_id: readiness[tool_id] for tool_id in missing_ids} == dict.fromkeys(missing_ids, "missing_config")


@pytest.mark.usefixtures("installed")
def test_other_tenants_rows_and_installs_never_leak(sqlite_session: Session) -> None:
    add_credential(sqlite_session, tenant_id=OTHER_TENANT_ID, provider=_HUDDLE, user_id=ACCOUNT_A)

    readiness = _readiness(account_id=ACCOUNT_A)

    assert readiness[f"{_HUDDLE}/post"] == "missing_config"
    # uninstalled here: a plugin installed only in another workspace is absent
    assert not any(tool_id.startswith("other/elsewhere/") for tool_id in readiness)


@pytest.mark.usefixtures("installed")
def test_an_unverifiable_credential_lookup_reports_not_ready_with_a_reason(
    sqlite_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    from services.dify_builder.agent import resources

    with sqlite_engine.begin() as connection:
        connection.execute(text("DROP TABLE tool_builtin_providers"))

    with caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.resources"):
        tools = {tool.id: tool for tool in resources.list_tenant_resources(TENANT_ID, account_id=ACCOUNT_A).tools}

    assert tools[f"{_HUDDLE}/post"].readiness == "missing_config"
    assert "could not be verified" in tools[f"{_HUDDLE}/post"].meta
    assert tools["acme/free/free/echo"].readiness == "ready"
    assert any("authorization" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)


def test_a_plugin_daemon_outage_keeps_hardcoded_tools_in_the_inventory(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    from services.dify_builder.agent import resources

    bind_database(monkeypatch, sqlite_engine)
    install_fake_daemon(monkeypatch, FakeToolDaemon(fail_all=True))
    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [])

    readiness = _readiness(account_id=ACCOUNT_A)

    assert readiness.get("time/current_time") == "ready"


def test_models_and_datasets_keep_their_semantics_for_an_actor(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import resources

    class _Model:
        def __init__(self, m: str) -> None:
            self.model = m

    class _ProvResp:
        def __init__(self, p: str, ms: list[str]) -> None:
            self.provider, self.models = p, [_Model(m) for m in ms]

    class _DS:
        def __init__(self, i: str, n: str) -> None:
            self.id, self.name = i, n

    monkeypatch.setattr(resources, "_list_models", lambda _tenant_id: [_ProvResp("anthropic", ["claude-opus-4-8"])])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant_id: [_DS("kb-1", "Company KB")])
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant_id: [])

    anonymous = resources.list_tenant_resources("t1")
    acting = resources.list_tenant_resources("t1", account_id=ACCOUNT_A)

    assert (
        acting.models
        == anonymous.models
        == [resources.ResourceRef(id="anthropic/claude-opus-4-8", label="anthropic/claude-opus-4-8")]
    )
    assert acting.datasets == anonymous.datasets == [resources.ResourceRef(id="kb-1", label="Company KB")]

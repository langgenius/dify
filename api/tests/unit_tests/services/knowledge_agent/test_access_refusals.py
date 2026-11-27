"""Knowledge-agent connections: what each request is refused for, and what a refusal leaves behind."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import TypedDict

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import TenantAccountJoin
from models.knowledge_agent import KnowledgeAgentGrant
from models.oauth import OAuthAccessToken
from services.knowledge_agent import knowledge_agent_origin_allowed
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
)
from services.knowledge_agent.clients import CLIENT_METADATA_MAX_BYTES, KnowledgeAgentClientRegistry
from services.knowledge_agent.contracts import ClientMetadataFetcher
from services.knowledge_agent.oauth import (
    REFRESH_TOKEN_TTL_SECONDS,
    KnowledgeAgentOAuthError,
    is_client_metadata_url,
    is_loopback_url,
    redirect_uri_matches,
    validate_redirect_uri,
)
from tests.helpers.unit.knowledge_agent import (
    CALLBACK,
    URLS,
    FakeRedis,
    World,
    authorize,
    code_form,
    exchange,
    knowledge_agent_world,
    pkce,
    register,
)

METADATA_URL = "https://agent.example/oauth/client.json"


class GrantView(TypedDict, total=False):
    id: str
    name: str
    knowledge_base_ids: list[str]
    account: dict[str, str]


class CreatedToken(TypedDict):
    grant: GrantView
    token: str


class WorkspaceView(TypedDict):
    agent_access_enabled: bool
    grants: list[GrantView]


class ConsentView(TypedDict):
    agent_access_enabled: bool
    client: dict[str, str]
    scopes: list[str]


class MovableClock:
    """The services' clock: starts now and moves only when a test says so."""

    def __init__(self) -> None:
        self.now = datetime.now(UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, by: timedelta) -> None:
        self.now += by


@pytest.fixture(autouse=True)
def _no_bearer_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("libs.oauth_bearer.enforce_bearer_rate_limit", lambda _hash: None)


@pytest.fixture
def clock() -> MovableClock:
    return MovableClock()


@pytest.fixture
def world(sqlite_session_factory: sessionmaker[Session], clock: MovableClock) -> Iterator[World]:
    with knowledge_agent_world(sqlite_session_factory, clock=clock) as built:
        yield built


def _request(client_id: object, **overrides: object) -> dict[str, object]:
    """A valid authorization request of ``client_id``, with the given parameters replaced."""
    _, challenge = pkce()
    return {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        **overrides,
    }


def _describe(world: World, params: dict[str, object]) -> ConsentView:
    described = world.service.describe_authorization(
        account=world.member_account, tenant_id=world.tenant, params=params, urls=URLS
    )
    return {
        "agent_access_enabled": described["agent_access_enabled"],
        "client": described["client"],
        "scopes": described["scopes"],
    }


def _refused_request(world: World, params: dict[str, object]) -> KnowledgeAgentAccessError:
    with pytest.raises(KnowledgeAgentAccessError) as error:
        _describe(world, params)
    return error.value


def _token_error(world: World, form: Mapping[str, object]) -> KnowledgeAgentOAuthError:
    with pytest.raises(KnowledgeAgentOAuthError) as error:
        world.service.exchange_token(dict(form), URLS)
    return error.value


def _personal_token(world: World, **body: object) -> CreatedToken:
    created = world.service.create_personal_token(
        account=world.member_account,
        tenant_id=world.tenant,
        body={"name": "CI", "knowledge_base_ids": ["kb-handbook"], **body},
    )
    # The response is the connection and the token, shown this once, and nothing else.
    assert set(created) == {"grant", "token"}
    return {"grant": created["grant"], "token": created["token"]}


def _refused_token(world: World, **body: object) -> KnowledgeAgentAccessError:
    with pytest.raises(KnowledgeAgentAccessError) as error:
        _personal_token(world, **body)
    return error.value


def _live_grants(world: World) -> list[str]:
    with world.sessions() as session:
        return list(session.scalars(select(KnowledgeAgentGrant.id).where(KnowledgeAgentGrant.revoked_at.is_(None))))


# -- The authorization request -----------------------------------------------------------------------


def test_an_authorization_request_must_ask_for_a_code_and_name_a_known_client(world: World) -> None:
    client_id = register(world)
    implicit = _refused_request(world, _request(client_id, response_type="token"))
    assert (implicit.status, implicit.code) == (422, "unsupported_response_type")
    absent = _refused_request(world, {key: value for key, value in _request(client_id).items() if key != "client_id"})
    assert (absent.status, absent.code, absent.message) == (422, "invalid_client", "client_id is required")
    for missing in ("", 7, None):
        assert _refused_request(world, _request(missing)).message == "client_id is required"
    unknown = _refused_request(world, _request("dfokc_never_registered"))
    assert (unknown.status, unknown.code, unknown.message) == (422, "invalid_client", "Unknown client")
    # A plain-HTTP URL is not a metadata document address, so it is looked up as a registered id.
    assert _refused_request(world, _request("http://agent.example/client.json")).message == "Unknown client"


def test_state_is_echoed_when_it_is_a_string_and_refused_when_it_is_too_long(world: World) -> None:
    client_id = register(world)

    def decide(state: object) -> str:
        return world.service.decide_authorization(
            account=world.member_account,
            tenant_id=world.tenant,
            body={**_request(client_id, state=state), "approve": False},
            urls=URLS,
        )["redirect_to"]

    assert "state=" + "s" * 1024 in decide("s" * 1024)
    # Not a string: there is nothing to echo, and the request is otherwise fine.
    for ignored in (42, "", None):
        redirect = decide(ignored)
        assert "state=" not in redirect
        assert redirect.startswith(f"{CALLBACK}?iss=")
        assert redirect.endswith("error=access_denied")
    with pytest.raises(KnowledgeAgentAccessError) as error:
        decide("s" * 1025)
    assert (error.value.status, error.value.code, error.value.message) == (422, "invalid_request", "state is too long")


def test_an_empty_resource_and_this_servers_own_resource_are_accepted(world: World) -> None:
    client_id = register(world)
    for resource in ("", None, URLS.resource, f"{URLS.resource}/"):
        assert _describe(world, _request(client_id, resource=resource))["scopes"] == ["knowledge:read"]
    for foreign in ("https://other.example/mcp/knowledge", ["https://dify.test/mcp/knowledge"]):
        assert _refused_request(world, _request(client_id, resource=foreign)).code == "invalid_target"
    asked = _describe(world, _request(client_id, scope="knowledge:read profile"))
    assert asked["scopes"] == ["knowledge:read"]
    assert _describe(world, _request(client_id, scope=["knowledge:read"]))["scopes"] == ["knowledge:read"]


# -- The token endpoint ------------------------------------------------------------------------------


def test_the_token_endpoint_refuses_unknown_grant_types_and_incomplete_code_requests(world: World) -> None:
    flow = authorize(world, client_id=register(world), spaces=["kb-handbook"])
    for grant_type in ("password", "client_credentials", None, ["authorization_code"]):
        unsupported = _token_error(world, {**code_form(flow), "grant_type": grant_type})
        assert (unsupported.error, unsupported.status) == ("unsupported_grant_type", 400)
    incomplete: list[dict[str, object]] = [
        {key: value for key, value in code_form(flow).items() if key != "code"},
        {**code_form(flow), "code": ""},
        {**code_form(flow), "code": ["x"]},
        {key: value for key, value in code_form(flow).items() if key != "client_id"},
        {**code_form(flow), "client_id": 7},
    ]
    for form in incomplete:
        missing = _token_error(world, form)
        assert (missing.error, missing.description) == ("invalid_request", "code and client_id are required")
    assert _live_grants(world) == []
    # None of these refusals spent the code.
    assert exchange(world, flow)["access_token"].startswith("dfok_")


def test_the_token_endpoint_is_closed_while_the_deployment_switch_is_off(world: World) -> None:
    client_id = register(world)
    flow = authorize(world, client_id=client_id, spaces=["kb-handbook"])
    world.deployment.on = False
    closed = _token_error(world, code_form(flow))
    assert (closed.error, closed.description, closed.status) == (
        "invalid_request",
        "Agent connections are not enabled",
        400,
    )
    assert _live_grants(world) == []
    world.deployment.on = True
    tokens = exchange(world, flow)
    world.deployment.on = False
    refresh = {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}
    assert _token_error(world, refresh).description == "Agent connections are not enabled"
    world.deployment.on = True
    # The refusal did not rotate the refresh token.
    assert world.service.exchange_token(refresh, URLS)["refresh_token"] != tokens["refresh_token"]


@pytest.mark.parametrize(
    ("change", "error", "description"),
    [
        ({"client_id": "other"}, "invalid_grant", "The authorization code is invalid"),
        (
            {"redirect_uri": "http://127.0.0.1:33418/elsewhere"},
            "invalid_grant",
            "redirect_uri does not match the authorization",
        ),
        ({"resource": "https://other.example/mcp"}, "invalid_target", "resource does not match the authorization"),
        ({"code_verifier": "v" * 43}, "invalid_grant", "PKCE verification failed"),
    ],
)
def test_a_code_presented_with_the_wrong_details_is_burnt_and_issues_nothing(
    world: World, change: dict[str, str], error: str, description: str
) -> None:
    client_id = register(world)
    other = register(world, "Another client")
    flow = authorize(world, client_id=client_id, spaces=["kb-handbook"])
    form = {**code_form(flow), **change}
    if form["client_id"] == "other":
        form["client_id"] = other
    refused = _token_error(world, form)
    assert (refused.error, refused.description, refused.status) == (error, description, 400)
    assert _live_grants(world) == []
    # The code is gone for the rightful client too, and nothing is left to revoke on a replay.
    again = _token_error(world, code_form(flow))
    assert (again.error, again.description) == ("invalid_grant", "The authorization code is invalid or expired")
    assert not [key for key in world.redis.values if key.startswith("knowledge_agent:code")]


def test_a_code_is_redeemed_with_the_redirect_uri_it_was_issued_for(world: World) -> None:
    flow = authorize(world, client_id=register(world), spaces=["kb-handbook"])
    tokens = world.service.exchange_token({**code_form(flow), "redirect_uri": CALLBACK, "resource": ""}, URLS)
    principal = world.service.authenticate(tokens["access_token"])
    assert isinstance(principal, KnowledgeAgentPrincipal)
    assert principal.control_space_ids == ("kb-handbook",)
    assert principal.client_name == "Claude Code"


def test_only_a_refresh_token_this_server_issued_and_still_holds_can_be_rotated(
    world: World, clock: MovableClock
) -> None:
    client_id = register(world)
    tokens = exchange(world, authorize(world, client_id=client_id, spaces=["kb-handbook"]))

    def refresh(token: object) -> dict[str, object]:
        return {"grant_type": "refresh_token", "refresh_token": token, "client_id": client_id}

    for foreign in (tokens["access_token"], "", None, "dfokr_never_issued"):
        invalid = _token_error(world, refresh(foreign))
        assert (invalid.error, invalid.description) == ("invalid_grant", "The refresh token is invalid")
    assert isinstance(world.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)

    clock.advance(timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS))
    expired = _token_error(world, refresh(tokens["refresh_token"]))
    assert (expired.error, expired.description) == ("invalid_grant", "The refresh token is no longer valid")
    # Expiry is not reuse: the connection is left alone and nothing was rotated.
    assert len(_live_grants(world)) == 1
    clock.advance(-timedelta(seconds=1))
    assert world.service.exchange_token(refresh(tokens["refresh_token"]), URLS)["access_token"].startswith("dfok_")


def test_a_member_who_left_the_workspace_cannot_refresh(world: World) -> None:
    client_id = register(world)
    tokens = exchange(world, authorize(world, client_id=client_id, spaces=["kb-handbook"]))
    with world.sessions.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == world.member))
    gone = _token_error(
        world, {"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"], "client_id": client_id}
    )
    assert (gone.error, gone.description) == ("invalid_grant", "The refresh token is no longer valid")
    assert world.service.authenticate(tokens["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_revocation_needs_a_token_and_an_access_token_ends_the_connection_too(world: World) -> None:
    tokens = exchange(world, authorize(world, client_id=register(world), spaces=["kb-handbook"]))
    forms: list[dict[str, object]] = [{}, {"token": ""}, {"token": ["dfok_x"]}, {"token_type_hint": "access_token"}]
    for form in forms:
        with pytest.raises(KnowledgeAgentOAuthError) as error:
            world.service.revoke_token(form)
        assert (error.value.error, error.value.description) == ("invalid_request", "token is required")
    assert isinstance(world.service.authenticate(tokens["access_token"]), KnowledgeAgentPrincipal)
    world.service.revoke_token({"token": tokens["access_token"]})
    assert world.service.authenticate(tokens["access_token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")
    assert _live_grants(world) == []


# -- Clients -----------------------------------------------------------------------------------------


def test_registration_requires_the_authorization_code_grant_and_cleans_the_client_name(world: World) -> None:
    uris = ["http://127.0.0.1/callback"]
    refused_grant_types: list[object] = [["refresh_token"], list[str](), "authorization_code"]
    for grant_types in refused_grant_types:
        with pytest.raises(KnowledgeAgentOAuthError) as error:
            world.service.register_client({"redirect_uris": uris, "grant_types": grant_types}, ip_address="10.0.0.1")
        assert (error.value.error, error.value.status) == ("invalid_client_metadata", 400)
        assert error.value.retry_after is None

    def name_of(raw: object) -> str:
        registered = world.service.register_client(
            {"redirect_uris": uris, "client_name": raw, "grant_types": ["authorization_code", "refresh_token"]},
            ip_address="10.0.0.2",
        )
        assert registered["grant_types"] == ["authorization_code", "refresh_token"]
        return registered["client_name"]

    assert name_of(" Claude\x00 Code\n") == "Claude Code"
    assert name_of("\x1b\x7f  ") == "MCP client"
    assert name_of(None) == "MCP client"
    assert name_of(["Claude"]) == "MCP client"
    assert name_of("n" * 300) == "n" * 120
    for count in (0, 11):
        with pytest.raises(KnowledgeAgentOAuthError) as error:
            world.service.register_client({"redirect_uris": uris * count}, ip_address="10.0.0.3")
        assert error.value.error == "invalid_redirect_uri"


def test_a_metadata_document_is_reused_for_a_day_then_refreshed_and_survives_an_outage(
    world: World, clock: MovableClock
) -> None:
    def name_now() -> object:
        described = _describe(world, _request(METADATA_URL, redirect_uri="http://localhost:61000/callback"))
        return described["client"]

    world.documents[METADATA_URL] = {"client_id": METADATA_URL, "redirect_uris": ["http://localhost/callback"]}
    # No client_name in the document: the host the document lives on is shown instead.
    assert name_now() == {"kind": "cimd", "name": "agent.example", "redirect_host": "localhost:61000"}

    world.documents[METADATA_URL] = {
        "client_id": METADATA_URL,
        "client_name": "Example Agent",
        "redirect_uris": ["http://localhost/callback"],
    }
    clock.advance(timedelta(hours=23, minutes=59))
    assert name_now() == {"kind": "cimd", "name": "agent.example", "redirect_host": "localhost:61000"}
    clock.advance(timedelta(minutes=1))
    assert name_now() == {"kind": "cimd", "name": "Example Agent", "redirect_host": "localhost:61000"}

    # The metadata host is down when the copy goes stale: the known client keeps working.
    del world.documents[METADATA_URL]
    clock.advance(timedelta(days=2))
    assert name_now() == {"kind": "cimd", "name": "Example Agent", "redirect_host": "localhost:61000"}
    # A client nobody has seen cannot be vouched for by a host that is down.
    unknown = _refused_request(world, _request("https://agent.example/other.json"))
    assert (unknown.code, unknown.message) == ("invalid_client", "The client metadata document could not be fetched")


@pytest.mark.parametrize(
    "redirect_uris",
    [None, [], "http://localhost/callback", ["http://evil.example/cb"], ["http://localhost/cb"] * 11, [7]],
)
def test_a_metadata_document_must_list_usable_redirect_uris(world: World, redirect_uris: object) -> None:
    world.documents[METADATA_URL] = {"client_id": METADATA_URL, "redirect_uris": redirect_uris}
    refused = _refused_request(world, _request(METADATA_URL))
    assert (refused.status, refused.code) == (422, "invalid_client")
    assert refused.message == "The client metadata document has invalid redirect URIs"


def _boom(_url: str) -> tuple[int, bytes]:
    raise TimeoutError("metadata host did not answer")


@pytest.mark.parametrize(
    ("fetcher", "message"),
    [
        (None, "Client metadata documents are not supported"),
        (_boom, "The client metadata document could not be fetched"),
        (lambda _url: (503, b"{}"), "The client metadata document could not be fetched"),
        (
            lambda _url: (200, b" " * (CLIENT_METADATA_MAX_BYTES + 1)),
            "The client metadata document could not be fetched",
        ),
        (lambda _url: (200, b"<html>not json</html>"), "The client metadata document is not valid JSON"),
        (
            lambda _url: (200, json.dumps([{"client_id": METADATA_URL}]).encode()),
            "The client metadata document names a different client",
        ),
    ],
    ids=["unsupported", "fetch-raises", "status-503", "oversized", "not-json", "not-an-object"],
)
def test_a_metadata_document_that_cannot_be_trusted_is_an_invalid_client_and_is_not_stored(
    sqlite_session_factory: sessionmaker[Session], fetcher: ClientMetadataFetcher | None, message: str
) -> None:
    registry = KnowledgeAgentClientRegistry(
        session_maker=sqlite_session_factory,
        redis_client=FakeRedis(),
        fetch_client_metadata=fetcher,
        clock=lambda: datetime.now(UTC),
    )
    for _ in range(2):
        with pytest.raises(KnowledgeAgentAccessError) as error:
            registry.resolve(METADATA_URL)
        assert (error.value.status, error.value.code, error.value.message) == (422, "invalid_client", message)


# -- URL rules ---------------------------------------------------------------------------------------


def test_redirect_uris_that_are_not_plain_https_or_loopback_urls_are_refused() -> None:
    for refused in (
        None,
        7,
        "",
        "https://app.example/" + "c" * 2048,
        "http://[::1/callback",
        "https://user:secret@app.example/cb",
        "https://user@app.example/cb",
        "https:///cb",
        "ftp://127.0.0.1/cb",
    ):
        assert validate_redirect_uri(refused) is None, refused
    for accepted in ("http://[::1]:8080/cb", "http://localhost/cb", "https://app.example/cb?x=1"):
        assert validate_redirect_uri(accepted) == accepted


def test_a_redirect_matches_exactly_or_on_a_loopback_host_with_any_port() -> None:
    registered = ["https://app.example/cb", "http://localhost/callback?x=1"]
    assert redirect_uri_matches(registered, "https://app.example/cb")
    assert redirect_uri_matches(registered, "http://localhost:4000/callback?x=1")
    assert not redirect_uri_matches(registered, "http://localhost:4000/callback?x=2")
    assert not redirect_uri_matches(registered, "http://127.0.0.1:4000/callback?x=1")
    assert not redirect_uri_matches(["https://app.example/cb"], "http://localhost/cb")
    # A URL that cannot be parsed matches nothing instead of failing the request.
    assert not redirect_uri_matches(registered, "http://[::1/callback")
    assert not is_loopback_url("http://[::1/callback")
    assert not is_loopback_url("https://localhost/callback")


def test_only_https_urls_with_a_path_and_no_credentials_are_metadata_documents() -> None:
    assert is_client_metadata_url(METADATA_URL)
    for refused in (
        "https://[agent.example/client.json",
        "https://agent.example/" + "c" * 2048,
        "https://agent.example/client.json#fragment",
        "https://user:secret@agent.example/client.json",
        "https://user@agent.example/client.json",
        "https://agent.example",
    ):
        assert not is_client_metadata_url(refused), refused


def test_an_unparseable_origin_is_not_a_loopback_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import knowledge_agent

    monkeypatch.setattr(knowledge_agent.dify_config, "SERVICE_API_URL", "")
    monkeypatch.setattr(knowledge_agent.dify_config, "CONSOLE_WEB_URL", "")
    assert knowledge_agent_origin_allowed("http://[::1]:3000")
    assert not knowledge_agent_origin_allowed("http://[::1")
    assert not knowledge_agent_origin_allowed("null")
    assert knowledge_agent_origin_allowed("")
    assert knowledge_agent_origin_allowed(None)


# -- Personal tokens and the switches ----------------------------------------------------------------


@pytest.mark.parametrize("name", ["", "   ", "n" * 101, None, 7])
def test_a_personal_token_needs_a_name_of_at_most_100_characters(world: World, name: object) -> None:
    refused = _refused_token(world, name=name)
    assert (refused.status, refused.code) == (422, "invalid_name")
    assert _live_grants(world) == []


def test_a_personal_token_name_is_trimmed_and_its_lifetime_is_bounded(world: World) -> None:
    created = _personal_token(world, name="  Laptop  ", expires_in_days=365)
    assert created["grant"]["name"] == "Laptop"
    for days in (0, 366, True, "7", 1.5):
        refused = _refused_token(world, expires_in_days=days)
        assert (refused.status, refused.code) == (422, "invalid_expiry")
    assert len(_live_grants(world)) == 1


@pytest.mark.parametrize(
    ("chosen", "message"),
    [
        (None, "Choose between 1 and 100 knowledge bases"),
        ([], "Choose between 1 and 100 knowledge bases"),
        ("kb-handbook", "Choose between 1 and 100 knowledge bases"),
        ([f"kb-{number}" for number in range(101)], "Choose between 1 and 100 knowledge bases"),
        (["kb-handbook", 7], "Knowledge base ids must be strings"),
        (["kb-handbook", ""], "Knowledge base ids must be strings"),
    ],
)
def test_the_chosen_knowledge_bases_must_be_one_to_a_hundred_ids(world: World, chosen: object, message: str) -> None:
    refused = _refused_token(world, knowledge_base_ids=chosen)
    assert (refused.status, refused.code, refused.message) == (422, "invalid_knowledge_bases", message)
    # Malformed choices are refused before anyone's permissions are looked up.
    assert world.spaces.calls == []
    assert _live_grants(world) == []


def test_a_choice_names_the_bases_that_are_unavailable_and_repeats_are_chosen_once(world: World) -> None:
    refused = _refused_token(world, knowledge_base_ids=["kb-handbook", "kb-unshared", "kb-gone"])
    assert (refused.status, refused.code) == (422, "invalid_knowledge_bases")
    assert refused.details == {"knowledge_base_ids": ["kb-unshared", "kb-gone"]}
    created = _personal_token(world, knowledge_base_ids=["kb-finance", "kb-handbook", "kb-finance"])
    assert sorted(created["grant"]["knowledge_base_ids"]) == ["kb-finance", "kb-handbook"]


def test_with_the_deployment_switch_off_nothing_can_be_created_and_bearers_get_a_404(world: World) -> None:
    client_id = register(world)
    token = _personal_token(world)["token"]
    world.deployment.on = False

    unavailable = _refused_token(world)
    assert (unavailable.status, unavailable.code) == (404, "agent_access_unavailable")
    with pytest.raises(KnowledgeAgentAccessError) as required:
        world.service.require_enabled()
    assert required.value.status == 404
    assert _refused_request(world, _request(client_id)).code == "agent_access_unavailable"
    with pytest.raises(KnowledgeAgentAccessError) as decided:
        world.service.decide_authorization(
            account=world.member_account,
            tenant_id=world.tenant,
            body={**_request(client_id), "approve": True, "knowledge_base_ids": ["kb-handbook"]},
            urls=URLS,
        )
    assert decided.value.code == "agent_access_unavailable"
    assert world.service.authenticate(token) == KnowledgeAgentAuthFailure(404, "agent_access_unavailable")
    # The member still sees their connection, and that the feature is off.
    mine = world.service.list_mine(account=world.member_account, tenant_id=world.tenant, urls=URLS)
    assert mine["available"] is False
    assert [grant["name"] for grant in mine["grants"]] == ["CI"]
    assert not [key for key in world.redis.values if key.startswith("knowledge_agent:code")]

    world.deployment.on = True
    world.service.require_enabled()
    assert isinstance(world.service.authenticate(token), KnowledgeAgentPrincipal)


def test_only_workspace_admins_see_and_set_the_workspace_switch(world: World) -> None:
    for role in ("normal", "editor", None):
        with pytest.raises(KnowledgeAgentAccessError) as read:
            world.service.workspace_settings(tenant_id=world.tenant, role=role)
        assert (read.value.status, read.value.code) == (403, "permission_denied")
        with pytest.raises(KnowledgeAgentAccessError) as write:
            world.service.update_workspace_settings(
                account=world.member_account, tenant_id=world.tenant, role=role, body={"enabled": False}
            )
        assert (write.value.status, write.value.code) == (403, "permission_denied")
    for value in (None, "false", 0, 1):
        with pytest.raises(KnowledgeAgentAccessError) as invalid:
            world.service.update_workspace_settings(
                account=world.admin_account, tenant_id=world.tenant, role="owner", body={"enabled": value}
            )
        assert (invalid.value.status, invalid.value.code) == (422, "invalid_agent_access")
    assert world.service.workspace_settings(tenant_id=world.tenant, role="admin") == {
        "agent_access_enabled": True,
        "grants": [],
    }


def test_the_workspace_switch_stops_new_and_existing_connections_until_it_is_turned_back_on(world: World) -> None:
    client_id = register(world)
    token = _personal_token(world, name="Laptop")["token"]

    def switch(enabled: bool) -> WorkspaceView:
        settings = world.service.update_workspace_settings(
            account=world.admin_account, tenant_id=world.tenant, role="owner", body={"enabled": enabled}
        )
        assert set(settings) == {"agent_access_enabled", "grants"}
        return {"agent_access_enabled": settings["agent_access_enabled"], "grants": settings["grants"]}

    off = switch(False)
    assert off["agent_access_enabled"] is False
    # The admin view names every member's connection and whose it is.
    assert [(grant["name"], grant["account"]) for grant in off["grants"]] == [
        ("Laptop", {"id": world.member, "name": "Mia", "email": "mia@example.com"})
    ]
    assert world.service.authenticate(token) == KnowledgeAgentAuthFailure(403, "agent_access_disabled")
    disabled = _refused_token(world)
    assert (disabled.status, disabled.code) == (403, "agent_access_disabled")
    # The consent page still opens, and says the switch is off; approving is what is refused.
    assert _describe(world, _request(client_id))["agent_access_enabled"] is False
    with pytest.raises(KnowledgeAgentAccessError) as approved:
        world.service.decide_authorization(
            account=world.member_account,
            tenant_id=world.tenant,
            body={**_request(client_id), "approve": True, "knowledge_base_ids": ["kb-handbook"]},
            urls=URLS,
        )
    assert (approved.value.status, approved.value.code) == (403, "agent_access_disabled")
    assert not [key for key in world.redis.values if key.startswith("knowledge_agent:code")]
    assert (
        world.service.list_mine(account=world.member_account, tenant_id=world.tenant, urls=URLS)["agent_access_enabled"]
        is False
    )

    # Turning it back on changes the same setting: the connection works again without reconnecting.
    assert switch(True)["agent_access_enabled"] is True
    assert isinstance(world.service.authenticate(token), KnowledgeAgentPrincipal)
    assert _personal_token(world, name="Phone")["grant"]["name"] == "Phone"


def test_a_connection_ended_just_after_its_bases_were_changed_reads_as_not_found(world: World) -> None:
    grant_id = _personal_token(world)["grant"]["id"]
    pending = [True]

    def disconnect_once(_session: Session) -> None:
        if pending:
            pending.clear()
            world.service.revoke_grant(
                account=world.admin_account, tenant_id=world.tenant, role="owner", grant_id=grant_id
            )

    # An admin disconnects the member between the write and the answer that would describe it.
    event.listen(world.sessions, "after_commit", disconnect_once)
    try:
        with pytest.raises(KnowledgeAgentAccessError) as error:
            world.service.update_grant(
                account=world.member_account,
                tenant_id=world.tenant,
                grant_id=grant_id,
                body={"knowledge_base_ids": ["kb-finance"]},
            )
    finally:
        event.remove(world.sessions, "after_commit", disconnect_once)
    assert (error.value.status, error.value.code) == (404, "agent_grant_not_found")
    assert pending == []
    assert _live_grants(world) == []


# -- Bearers -----------------------------------------------------------------------------------------


def test_a_bearer_whose_row_is_gone_is_refused_even_while_it_is_still_cached(world: World) -> None:
    created = _personal_token(world)
    assert isinstance(world.service.authenticate(created["token"]), KnowledgeAgentPrincipal)
    with world.sessions.begin() as session:
        session.execute(
            delete(OAuthAccessToken).where(OAuthAccessToken.knowledge_agent_grant_id == created["grant"]["id"])
        )
    assert world.service.authenticate(created["token"]) == KnowledgeAgentAuthFailure(401, "invalid_token")


def test_the_bases_of_a_connection_are_narrowed_before_anything_is_looked_up(world: World) -> None:
    created = _personal_token(world, knowledge_base_ids=["kb-handbook", "kb-finance"])
    principal = world.service.authenticate(created["token"])
    assert isinstance(principal, KnowledgeAgentPrincipal)
    world.spaces.calls.clear()

    # A base the connection was not given is never asked about, readable or not.
    assert world.service.knowledge_bases_for(principal, among=["kb-board", "kb-unknown"]) == set()
    assert world.service.knowledge_bases_for(principal, among=[]) == set()
    assert world.spaces.calls == []

    assert world.service.knowledge_bases_for(principal, among=["kb-finance", "kb-board"]) == {"kb-finance"}
    assert world.spaces.calls == [("readable", ("kb-finance",)), ("blocked", ("kb-finance",))]

    # Nothing readable any more: the per-base switches are not consulted at all.
    world.spaces.calls.clear()
    world.spaces.readable_ids.clear()
    assert world.service.knowledge_bases_for(principal) == set()
    assert world.spaces.calls == [("readable", ("kb-finance", "kb-handbook"))]

    world.spaces.readable_ids.update({"kb-handbook", "kb-finance"})
    world.spaces.blocked_ids.add("kb-finance")
    assert world.service.knowledge_bases_for(principal) == {"kb-handbook"}

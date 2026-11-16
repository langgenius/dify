"""Exercise external MCP deletion through HTTP, admission, composition, and persistence."""

from collections.abc import Callable

import pytest
from flask import Flask, g
from flask.testing import FlaskClient
from redis import Redis
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp
from core.rbac import RBACPermission
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_redis import RedisClientWrapper
from libs.flask_restx_compat import install_swagger_compatibility
from models.tools import MCPToolProvider
from tests.helpers.unit.model_factories import make_account, make_tenant
from tests.helpers.unit.rbac_fakes import RBACDomain

WORKSPACE_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
PROVIDER_ID = "33333333-3333-3333-3333-333333333333"
FOREIGN_PROVIDER_ID = "44444444-4444-4444-4444-444444444444"
MISSING_PROVIDER_ID = "55555555-5555-5555-5555-555555555555"
ACCOUNT_ID = "66666666-6666-6666-6666-666666666666"
URL = "/console/api/workspaces/current/tool-provider/mcp"


@pytest.fixture
def client(
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    rbac_domain: RBACDomain,
) -> FlaskClient:
    """Seed two workspaces and expose the production route with an authenticated account."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=True)
    rbac_domain.transport.response = {"allowed": True}
    with sqlite_session_factory.begin() as session:
        for provider_id, workspace_id in (
            (PROVIDER_ID, WORKSPACE_ID),
            (FOREIGN_PROVIDER_ID, FOREIGN_WORKSPACE_ID),
        ):
            provider = MCPToolProvider(
                name="MCP provider",
                server_identifier=MISSING_PROVIDER_ID,
                server_url="encrypted-url",
                server_url_hash="url-hash",
                icon=None,
                tenant_id=workspace_id,
                user_id=ACCOUNT_ID,
            )
            provider.id = provider_id
            session.add(provider)
    app = Flask(__name__)
    app.register_blueprint(bp)
    redis = RedisClientWrapper()
    redis.initialize(Redis())
    app.extensions["application_services"] = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=redis,
    )

    @app.before_request
    def authenticated_account() -> None:
        """Supply an active account in the calling workspace before admission runs."""
        g._login_user = make_account(account_id=ACCOUNT_ID, tenant=make_tenant(tenant_id=WORKSPACE_ID))

    return app.test_client()


def stored_ids(sessions: sessionmaker[Session]) -> set[str]:
    """Read committed provider IDs through a fresh session without changing data."""
    with sessions() as session:
        return set(session.scalars(select(MCPToolProvider.id)))


@pytest.mark.parametrize("source", ["json", "query"])
def test_delete_commits_only_the_callers_provider(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], rbac_domain: RBACDomain, source: str
) -> None:
    """An admitted JSON or query request commits one deletion and preserves foreign providers."""
    response = (
        client.delete(URL, json={"provider_id": PROVIDER_ID})
        if source == "json"
        else client.delete(URL, query_string={"provider_id": PROVIDER_ID})
    )

    assert response.status_code == 200
    assert response.json == {"result": "success"}
    assert stored_ids(sqlite_session_factory) == {FOREIGN_PROVIDER_ID}
    assert rbac_domain.transport.only_request.json == {
        "account_id": ACCOUNT_ID,
        "tenant_id": WORKSPACE_ID,
        "scene": RBACPermission.MCP_MANAGE,
    }

    repeated = client.delete(URL, json={"provider_id": PROVIDER_ID})
    assert repeated.status_code == 400
    assert repeated.json == {"code": "invalid_param", "message": "MCP tool not found", "status": 400}


def test_delete_query_takes_precedence_over_json(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """When both inputs exist, preserve the legacy query precedence and workspace isolation."""
    response = client.delete(URL, query_string={"provider_id": PROVIDER_ID}, json={"provider_id": FOREIGN_PROVIDER_ID})

    assert response.status_code == 200
    assert stored_ids(sqlite_session_factory) == {FOREIGN_PROVIDER_ID}


@pytest.mark.parametrize("provider_id", [MISSING_PROVIDER_ID, FOREIGN_PROVIDER_ID])
def test_delete_missing_or_foreign_provider_is_indistinguishable(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], provider_id: str
) -> None:
    """Missing IDs, including an existing server identifier, and foreign IDs leave all rows intact."""
    response = client.delete(URL, json={"provider_id": provider_id})

    assert response.status_code == 400
    assert response.json == {"code": "invalid_param", "message": "MCP tool not found", "status": 400}
    assert stored_ids(sqlite_session_factory) == {PROVIDER_ID, FOREIGN_PROVIDER_ID}


@pytest.mark.parametrize("provider_id", ["", "not-a-uuid"])
def test_delete_invalid_uuid_preserves_error(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], provider_id: str
) -> None:
    """Malformed strings keep the legacy error response and cannot mutate providers."""
    response = client.delete(URL, json={"provider_id": provider_id})

    assert response.status_code == 400
    assert response.json == {
        "code": "invalid_param",
        "message": "expected a valid UUID, but got: " + provider_id,
        "status": 400,
    }
    assert stored_ids(sqlite_session_factory) == {PROVIDER_ID, FOREIGN_PROVIDER_ID}


@pytest.mark.parametrize("payload", [{}, {"provider_id": None}, {"provider_id": 1}])
def test_delete_rejects_invalid_payload(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], payload: dict[str, object]
) -> None:
    """Missing and non-string IDs fail request validation without changing either workspace."""
    response = client.delete(URL, json=payload)

    assert response.status_code == 422
    assert stored_ids(sqlite_session_factory) == {PROVIDER_ID, FOREIGN_PROVIDER_ID}


@pytest.mark.parametrize("provider_id", [PROVIDER_ID, "not-a-uuid"])
def test_delete_requires_permission_before_parsing(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], rbac_domain: RBACDomain, provider_id: str
) -> None:
    """A denied account receives Forbidden before parsing and cannot delete any provider."""
    rbac_domain.transport.response = {"allowed": False}

    response = client.delete(URL, json={"provider_id": provider_id})

    assert response.status_code == 403
    assert stored_ids(sqlite_session_factory) == {PROVIDER_ID, FOREIGN_PROVIDER_ID}


def test_delete_database_failure_rolls_back(
    client: FlaskClient, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """A database failure after deletion rolls back the row and never reports success."""
    with sqlite_engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_provider_delete AFTER DELETE ON tool_mcp_providers "
            "BEGIN SELECT RAISE(FAIL, 'delete rejected'); END"
        )

    response = client.delete(URL, json={"provider_id": PROVIDER_ID})

    assert response.status_code == 500
    assert stored_ids(sqlite_session_factory) == {PROVIDER_ID, FOREIGN_PROVIDER_ID}


def test_mcp_schema_keeps_all_methods_and_delete_contract(client: FlaskClient) -> None:
    """Extracting the DELETE handler must preserve sibling operations and existing schema names."""
    install_swagger_compatibility()
    response = client.get("/console/api/openapi.json")

    assert response.status_code == 200
    document = response.get_json()
    assert isinstance(document, dict)
    operations = document["paths"]["/workspaces/current/tool-provider/mcp"]
    assert set(operations) == {"post", "put", "delete"}
    assert operations["delete"]["operationId"] == "delete_tool_provider_mcp_api"
    assert operations["delete"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/MCPProviderDeletePayload"
    }
    assert operations["delete"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SimpleResultResponse"
    }

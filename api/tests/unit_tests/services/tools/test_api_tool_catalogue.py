"""Native API discovery reads public installed bundles, never credential owners.

Real SQLite rows travel through catalogue, Builder resources and hydration.
Only daemon I/O is replaced. The response declaration deliberately exceeds
the native output schema: discovery must not manufacture dynamic selectors.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import NoReturn, cast
from uuid import uuid4

import pytest
from sqlalchemy import insert, text
from sqlalchemy.engine import Engine

from core.tools.utils.parser import ApiBasedToolSchemaParser
from core.workflow.generator.tool_catalogue import (
    ToolCapabilityQuery,
    ToolCatalogueEntry,
    build_tool_catalogue,
    find_tool_entry,
    format_tool_catalogue,
    installed_tool_keys,
    select_tool_candidates,
)
from core.workflow.generator.types import GraphDict
from models.tools import ApiToolProvider
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    OTHER_TENANT_ID,
    TENANT_ID,
    FakeToolDaemon,
    forbid_secret_and_business_calls,
    install_fake_daemon,
    record_sql,
)

PROVIDER_ID = "14076462-4152-4ef0-aad2-3eaea9369b1a"
ACTION = "qa_news_search"
DECLARED_RESPONSE = "Declared response root news[] contains required title and url; optional source."
CONTROLLED_DESCRIPTION = (
    "Synthetic test action. Bind Tool query to runtime Start.keyword; fixed timespan=24h/maxrecords=5. "
    "Declared response root news; project title/url and limit to five. Test transport only, no live requests."
)

type PublicInventory = tuple[Engine, list[str], list[str]]


def _bundle(action: str = ACTION) -> dict[str, object]:
    return {
        "server_url": "https://eng1106-fixture.invalid/news",
        "method": "get",
        "operation_id": action,
        "summary": "QA News Search",
        "author": "QA",
        "parameters": [
            {
                "name": name,
                "label": {"en_US": name},
                "type": kind,
                "form": "llm",
                "required": True,
            }
            for name, kind in [("query", "string"), ("timespan", "string"), ("maxrecords", "number")]
        ],
        "openapi": {
            "operationId": action,
            "description": DECLARED_RESPONSE,
            "responses": {
                "200": {
                    "content": {
                        "application/json": {"schema": {"type": "object", "properties": {"news": {"type": "array"}}}}
                    }
                }
            },
        },
        "output_schema": {},
    }


def _add_provider(
    engine: Engine,
    *,
    provider_id: str = PROVIDER_ID,
    tenant_id: str = TENANT_ID,
    name: str = "QA News Search",
    user_id: str = ACCOUNT_B,
    tools: object = None,
) -> None:
    """Insert a complete stored fixture without loading an API ORM entity."""
    with engine.begin() as connection:
        connection.execute(
            insert(ApiToolProvider).values(
                id=provider_id,
                tenant_id=tenant_id,
                user_id=user_id,
                name=name,
                description="Search recent news headlines.",
                icon='{"type":"emoji","icon":"newspaper"}',
                schema="{}",
                schema_type_str="openapi",
                tools_str=json.dumps([_bundle()] if tools is None else tools),
                credentials_str='{"must_not_read":"encrypted-marker"}',
            )
        )


def _add_parsed_public_fixture(engine: Engine) -> None:
    """Persist the approved public fixture through the real native parser."""
    fixture = Path(__file__).with_name("fixtures") / "qa_news_search_openapi.json"
    schema = cast(dict[str, object], json.loads(fixture.read_text()))
    bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(schema)
    _add_provider(engine, tools=[bundle.model_dump(mode="json") for bundle in bundles])


@pytest.fixture
def public_inventory(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> PublicInventory:
    from core.tools.custom_tool.provider import ApiToolProviderController
    from core.tools.tool_manager import ToolManager
    from services.dify_builder.agent import resources
    from services.tools.api_tools_manage_service import ApiToolManageService
    from services.tools.tools_transform_service import ToolTransformService

    install_fake_daemon(monkeypatch, FakeToolDaemon())
    monkeypatch.setattr(resources, "_list_models", lambda _tenant: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant: [])
    forbidden = forbid_secret_and_business_calls(monkeypatch)

    def deny(name: str) -> Callable[..., NoReturn]:
        def fail(*_args: object, **_kwargs: object) -> NoReturn:
            forbidden.append(name)
            raise AssertionError(f"API discovery must not call {name}")

        return fail

    for owner, name in [
        (ApiToolManageService, "list_api_tools"),
        (ApiToolProviderController, "from_db"),
        (ApiToolProviderController, "get_tools"),
        (ToolTransformService, "api_provider_to_controller"),
        (ToolManager, "get_api_provider_controller"),
    ]:
        monkeypatch.setattr(owner, name, deny(name))
    return sqlite_engine, forbidden, record_sql(sqlite_engine)


def test_public_api_rows_join_complete_catalogue_with_full_native_identity(public_inventory: PublicInventory) -> None:
    engine, forbidden, sql = public_inventory
    _add_provider(engine)
    sql.clear()

    entries = build_tool_catalogue(TENANT_ID)
    entry = find_tool_entry(entries, PROVIDER_ID, ACTION)

    assert entry is not None
    assert entry["provider_type"] == "api"
    assert entry["tool_label"] == "qa_news_search"
    assert entry["plugin_id"] == ""
    assert entry["provider_label"] == "QA News Search"
    assert entry["provider_description"] == "Search recent news headlines."
    assert DECLARED_RESPONSE in entry["description"]
    assert entry["output_schema"] == {}
    assert [(p["name"], p["type"], p["required"]) for p in entry["parameters"]] == [
        ("query", "string", True),
        ("timespan", "string", True),
        ("maxrecords", "number", True),
    ]
    assert ("time", "current_time") in installed_tool_keys(entries)
    api_reads = [query.lower() for query in sql if "tool_api_providers" in query.lower()]
    assert api_reads
    assert all(
        "credentials_str" not in query and "user_id" not in query and "schema_type_str" not in query
        for query in api_reads
    )
    assert forbidden == []


def test_real_openapi_parser_bundle_uses_native_action_label(public_inventory: PublicInventory) -> None:
    engine, forbidden, _sql = public_inventory
    _add_parsed_public_fixture(engine)

    entry = find_tool_entry(build_tool_catalogue(TENANT_ID), PROVIDER_ID, ACTION)

    assert entry is not None
    assert entry["tool_label"] == "qa_news_search"
    assert entry["provider_label"] == "QA News Search"
    assert entry["provider_type"] == "api"
    assert entry["output_schema"] == {}
    assert [(p["name"], p["type"], p["required"]) for p in entry["parameters"]] == [
        ("query", "string", True),
        ("timespan", "string", True),
        ("maxrecords", "number", True),
    ]
    assert forbidden == []


def test_real_openapi_parser_bundle_includes_capability_description_once(public_inventory: PublicInventory) -> None:
    engine, forbidden, _sql = public_inventory
    _add_parsed_public_fixture(engine)

    entry = find_tool_entry(build_tool_catalogue(TENANT_ID), PROVIDER_ID, ACTION)

    assert entry is not None
    assert entry["description"] == CONTROLLED_DESCRIPTION
    assert forbidden == []


def test_api_visibility_is_tenant_wide_and_does_not_filter_by_creator(public_inventory: PublicInventory) -> None:
    engine, forbidden, _sql = public_inventory
    _add_provider(engine, user_id=ACCOUNT_B)
    foreign_id = str(uuid4())
    _add_provider(engine, provider_id=foreign_id, tenant_id=OTHER_TENANT_ID, name="Foreign News")

    from services.dify_builder.agent import resources

    own = resources.list_tenant_resources(TENANT_ID, account_id=ACCOUNT_A)
    other = resources.list_tenant_resources(OTHER_TENANT_ID, account_id=ACCOUNT_A)

    assert f"{PROVIDER_ID}/{ACTION}" in {tool.id for tool in own.tools}
    assert f"{foreign_id}/{ACTION}" not in {tool.id for tool in own.tools}
    assert f"{foreign_id}/{ACTION}" in {tool.id for tool in other.tools}
    assert f"{PROVIDER_ID}/{ACTION}" not in {tool.id for tool in other.tools}
    assert forbidden == []


def test_api_provider_label_routes_to_uuid_and_formatter_preserves_native_type(
    public_inventory: PublicInventory,
) -> None:
    engine, _forbidden, _sql = public_inventory
    bundle = _bundle("lookup")
    bundle["summary"] = "Lookup"
    cast(dict[str, object], bundle["openapi"])["description"] = "Fetch records."
    _add_provider(engine, tools=[bundle])

    selected = select_tool_candidates(
        build_tool_catalogue(TENANT_ID), [ToolCapabilityQuery(capability="QA News Search", keywords=[])]
    )

    assert (PROVIDER_ID, "lookup") in installed_tool_keys(selected.entries)
    formatted = format_tool_catalogue(selected.entries)
    assert f'provider_id="{PROVIDER_ID}"' in formatted
    assert 'tool_name="lookup"' in formatted
    assert 'provider_type="api"' in formatted


@pytest.mark.parametrize("bad_tools", ["not-a-list", {"action": "bad"}, [{"operation_id": "bad"}], [None]])
def test_malformed_api_provider_does_not_remove_healthy_inventory(
    public_inventory: PublicInventory, bad_tools: object
) -> None:
    engine, forbidden, _sql = public_inventory
    _add_provider(engine)
    _add_provider(engine, provider_id=str(uuid4()), name="Broken API", tools=bad_tools)

    keys = installed_tool_keys(build_tool_catalogue(TENANT_ID))

    assert (PROVIDER_ID, ACTION) in keys
    assert ("time", "current_time") in keys
    assert forbidden == []


def test_malformed_bundle_is_scoped_to_its_action(public_inventory: PublicInventory) -> None:
    engine, _forbidden, _sql = public_inventory
    _add_provider(engine, tools=[None, _bundle()])

    assert (PROVIDER_ID, ACTION) in installed_tool_keys(build_tool_catalogue(TENANT_ID))


def test_api_metadata_query_failure_keeps_healthy_builtin_inventory(public_inventory: PublicInventory) -> None:
    engine, forbidden, _sql = public_inventory
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE tool_api_providers"))

    assert ("time", "current_time") in installed_tool_keys(build_tool_catalogue(TENANT_ID))
    assert forbidden == []


def test_api_inventory_remains_complete_beyond_prompt_cap(public_inventory: PublicInventory) -> None:
    engine, _forbidden, _sql = public_inventory
    _add_provider(engine, tools=[_bundle(f"news_{index:03d}") for index in range(100)])

    entries = build_tool_catalogue(TENANT_ID)

    assert (PROVIDER_ID, "news_099") in installed_tool_keys(entries)
    assert len([entry for entry in entries if entry["provider_type"] == "api"]) == 100
    assert len(format_tool_catalogue(entries).splitlines()) == 80


@pytest.mark.parametrize("authorized", [None, set(), {PROVIDER_ID}])
@pytest.mark.parametrize("needs_credentials", [False, True])
def test_api_readiness_cannot_borrow_builtin_authorization(
    authorized: set[str] | None, needs_credentials: bool
) -> None:
    from services.dify_builder.agent import resources

    entry = {"provider_name": PROVIDER_ID, "provider_type": "api", "needs_credentials": needs_credentials}

    readiness, note = resources._tool_readiness(cast(ToolCatalogueEntry, entry), authorized)

    assert readiness == "missing_config"
    assert "authorization" in note.lower()
    assert "not verified" in note.lower() or "could not be verified" in note.lower()


def test_api_only_resources_stay_bindable_without_credential_queries(
    public_inventory: PublicInventory, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, forbidden, _sql = public_inventory
    _add_provider(engine)
    from core.workflow.generator import tool_catalogue
    from services.dify_builder.agent import build, resources

    # Isolate the API inventory: builtin credentials are an independent owner.
    monkeypatch.setattr(tool_catalogue.ToolManager, "list_hardcoded_providers", lambda: [])

    def no_credentials(*_args: object, **_kwargs: object) -> NoReturn:
        forbidden.append("builtin credential query")
        raise AssertionError("API-only resource discovery must not query builtin credentials")

    monkeypatch.setattr(resources, "_authorized_providers", no_credentials)
    tools = build.ready_tool_catalogue(TENANT_ID, account_id=ACCOUNT_A, goal_text="QA News Search")

    assert len(tools) == 1
    assert tools[0].readiness == "missing_config"
    assert "authorization" in tools[0].meta.lower()
    assert "not verified" in tools[0].meta.lower() or "could not be verified" in tools[0].meta.lower()
    bound = build.bind_resources(None, TENANT_ID, ["Search news"], [f"{PROVIDER_ID}/{ACTION}"], account_id=ACCOUNT_A)
    assert bound == [f"Search news (using qa_news_search [{PROVIDER_ID}/{ACTION}])"]
    assert forbidden == []


def test_native_api_catalogue_hydration_preserves_runtime_keyword_and_fixed_parameters(
    public_inventory: PublicInventory,
) -> None:
    engine, forbidden, _sql = public_inventory
    _add_provider(engine)
    from services.workflow_generation.runner import WorkflowGenerator

    parameters = {
        "query": {"type": "variable", "value": ["start", "keyword"]},
        "timespan": {"type": "constant", "value": "24h"},
        "maxrecords": {"type": "constant", "value": 5},
    }
    graph = cast(
        GraphDict,
        {"nodes": [{"id": "search", "data": {"type": "tool", "tool_parameters": parameters}}], "edges": []},
    )
    WorkflowGenerator._hydrate_tool_nodes(
        graph=graph,
        plan_nodes=[{"id": "search", "node_type": "tool", "tool": {"provider_id": PROVIDER_ID, "tool_name": ACTION}}],
        tool_catalogue_entries=build_tool_catalogue(TENANT_ID),
    )

    data = graph["nodes"][0]["data"]
    assert data["provider_id"] == PROVIDER_ID
    assert data["provider_type"] == "api"
    assert data["tool_name"] == ACTION
    assert data["tool_parameters"] == parameters
    assert data["params"] == {"query": "", "timespan": "", "maxrecords": ""}
    assert data["output_schema"] == {}
    assert "news" not in data["output_schema"]
    assert "credential_id" not in data
    assert "plugin_id" not in data
    assert forbidden == []

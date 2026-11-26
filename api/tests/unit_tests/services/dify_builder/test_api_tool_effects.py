"""Custom API effect approval follows stored behavior through native Tool admission."""

from copy import deepcopy
from typing import Never

import httpx
import pytest
from sqlalchemy import Engine, Table

from core.dify_builder.models import Graph
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.utils.parser import ApiBasedToolSchemaParser
from services.dify_builder.code_risk_assessment import assess_code, code_facts
from services.dify_builder.effect_disclosure import disclose
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as _full_run_harness

harness = _full_run_harness


def api_graph() -> Graph:
    return {
        "nodes": [
            {
                "id": "api",
                "data": {
                    "type": "tool",
                    "provider_type": "api",
                    "provider_id": "owned-provider",
                    "tool_name": "get_invoice",
                    "tool_parameters": {"amount": {"type": "constant", "value": 5}},
                },
            }
        ],
        "edges": [],
    }


def bundle(description: str = "Creates an invoice.", path: str = "/invoices", method: str = "post") -> ApiToolBundle:
    return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(
        {
            "openapi": "3.0.3",
            "info": {"title": "Synthetic", "version": "1"},
            "servers": [{"url": "https://synthetic.example.invalid"}],
            "paths": {
                path: {
                    method: {
                        "operationId": "get_invoice",
                        "description": description,
                        "requestBody": {
                            "required": True,
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"amount": {"type": "integer"}},
                                        "required": ["amount"],
                                    }
                                }
                            },
                        },
                        "responses": {"200": {"description": "ok"}},
                    }
                }
            },
        }
    )[0]


def test_read_shaped_api_name_without_owned_definition_never_runs() -> None:
    effects = disclose(api_graph())
    assert effects.mocked_node_ids({}) == frozenset({"api"})
    assert effects.items[0].tier == "side_effect"


@pytest.mark.parametrize(
    ("description", "classification", "tier", "mocked"),
    [
        ("Creates an invoice.", "side_effect", "side_effect", True),
        ("Searches invoices without changing stored records.", "read", "read", False),
        ("Deletes invoices permanently.", "destructive", "destructive", True),
        ("Operation behavior is undocumented.", "unknown", "side_effect", True),
    ],
)
def test_owned_api_definition_uses_semantic_assessment(
    description: str, classification: str, tier: str, mocked: bool
) -> None:
    from services.dify_builder.api_tool_effects import api_definition

    graph = api_graph()
    definitions = {"api": api_definition("owned-provider", bundle(description), "credential-version")}
    facts = code_facts(
        graph,
        inputs={},
        goal_text="Review invoices",
        model_config={"name": "selected"},
        scope_binding="",
        api_tool_definitions=definitions,
    )["api"]
    assert facts.model_facts["api_tool"]["method"] == "post"
    assert facts.model_facts["api_tool"]["openapi"]["description"] == description
    risk = assess_code(facts, reason=lambda _: {"classification": classification, "risk_notice": description})
    effects = disclose(
        graph,
        code_risk_assessments={"api": risk.model_dump()},
        code_facts_digests={"api": facts.digest},
        api_tool_definitions=definitions,
    )
    assert effects.items[0].tier == tier
    assert "amount=5" in effects.items[0].object
    assert ("api" in effects.mocked_node_ids({})) is mocked
    if classification == "side_effect":
        confirmation = effects.confirmation(["api"])
        assert effects.mocked_node_ids(confirmation) == frozenset()
        changed = {"api": api_definition("owned-provider", bundle(description, "/other"), "credential-version")}
        changed_facts = code_facts(
            graph,
            inputs={},
            goal_text="Review invoices",
            model_config={"name": "selected"},
            scope_binding="",
            api_tool_definitions=changed,
        )["api"]
        stale = disclose(
            graph,
            code_risk_assessments={"api": risk.model_dump()},
            code_facts_digests={"api": changed_facts.digest},
            api_tool_definitions=changed,
        )
        assert stale.mocked_node_ids(confirmation) == frozenset({"api"})
        changed_graph = deepcopy(graph)
        changed_graph["nodes"][0]["data"]["tool_parameters"]["amount"]["value"] = 6
        assert disclose(
            changed_graph,
            code_risk_assessments={"api": risk.model_dump()},
            code_facts_digests={"api": facts.digest},
            api_tool_definitions=definitions,
        ).mocked_node_ids(confirmation) == frozenset({"api"})


@pytest.mark.parametrize("drift", ["target", "method", "declaration", "credentials"])
def test_native_admission_refuses_owned_api_drift_before_decryption(
    drift: str, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    import json
    from dataclasses import dataclass

    from sqlalchemy.orm import Session

    from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolProviderType
    from core.tools.tool_manager import ToolManager
    from models.tools import ApiToolProvider
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
    from services.dify_builder.api_tool_effects import provider_definition

    table = ApiToolProvider.__table__
    assert isinstance(table, Table)
    table.create(sqlite_engine, checkfirst=True)
    with Session(sqlite_engine) as sql:
        provider = ApiToolProvider(
            name="Synthetic",
            icon="{}",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id="",
            tenant_id="tenant",
            description="Synthetic",
            tools_str=json.dumps([bundle().model_dump(mode="json")]),
            credentials_str='{"auth_type":"none"}',
        )
        sql.add(provider)
        sql.commit()
        expected = canonical_digest(provider_definition(provider, "get_invoice"))
        changed = bundle().model_dump(mode="json")
        if drift == "target":
            changed["server_url"] = "https://changed.example.invalid/invoices"
        elif drift == "method":
            changed["method"] = "get"
        elif drift == "declaration":
            changed["openapi"]["description"] = "Different behavior"
        else:
            provider.credentials_str = '{"auth_type":"none","version":"changed"}'
        provider.tools_str = json.dumps([changed])
        sql.commit()

        @dataclass
        class Database:
            session: Session
            engine: Engine

        monkeypatch.setattr("core.tools.tool_manager.db", Database(sql, sqlite_engine))

        def never_decrypt(**_: object) -> Never:
            pytest.fail("stale custom API definition reached credential decryption")

        monkeypatch.setattr("core.tools.tool_manager.create_tool_provider_encrypter", never_decrypt)
        with pytest.raises(BuilderExecutionPolicyError, match="api_tool_definition_stale"):
            ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.API,
                provider_id=provider.id,
                tool_name="get_invoice",
                tenant_id="tenant",
                builder_expected_api_binding=expected,
            )


def test_bound_api_cannot_use_another_credential_version_from_provider_name_cache(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    import json
    from dataclasses import dataclass

    from sqlalchemy.orm import Session

    from core.helper.provider_cache import SingletonProviderCredentialsCache
    from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolProviderType
    from core.tools.tool_manager import ToolManager
    from models.tools import ApiToolProvider
    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.api_tool_effects import provider_definition
    from tests.unit_tests.core.tools.test_tool_manager import _CallableSessionProxy

    table = ApiToolProvider.__table__
    assert isinstance(table, Table)
    table.create(sqlite_engine, checkfirst=True)
    requests: list[httpx.Request] = []
    monkeypatch.setattr(
        SingletonProviderCredentialsCache,
        "get",
        lambda _: {
            "auth_type": "api_key_header",
            "api_key_value": "stale-cache-secret",
        },
    )

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"synthetic": True})

    with Session(sqlite_engine) as sql, httpx.Client(transport=httpx.MockTransport(record)) as client:
        provider = ApiToolProvider(
            name="Synthetic",
            icon="{}",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id="",
            tenant_id="tenant",
            description="Synthetic",
            tools_str=json.dumps([bundle().model_dump(mode="json")]),
            credentials_str='{"auth_type":"none"}',
        )
        sql.add(provider)
        sql.commit()

        @dataclass
        class Database:
            session: _CallableSessionProxy
            engine: Engine

        monkeypatch.setattr("core.tools.tool_manager.db", Database(_CallableSessionProxy(sql), sqlite_engine))
        monkeypatch.setattr("core.helper.ssrf_proxy._get_ssrf_client", lambda _: client)
        tool = ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.API,
            provider_id=provider.id,
            tool_name="get_invoice",
            tenant_id="tenant",
            builder_expected_api_binding=canonical_digest(provider_definition(provider, "get_invoice")),
        )
        list(tool.invoke(session=sql, user_id="owner", tool_parameters={"amount": 5}))
    assert len(requests) == 1
    assert "authorization" not in requests[0].headers


def test_api_reasoning_withholds_parameter_values_account_version_and_url_secrets() -> None:
    import json

    from services.dify_builder.api_tool_effects import api_definition

    graph = api_graph()
    graph["nodes"][0]["data"]["tool_parameters"]["amount"]["value"] = "private-parameter-body"
    operation = bundle()
    operation.server_url = "https://user:password@synthetic.example.invalid/invoices?key=private-key#private-fragment"
    definitions = {"api": api_definition("owned-provider", operation, "private-account-version")}
    facts = code_facts(
        graph,
        inputs={},
        goal_text="Review invoices",
        model_config={"name": "selected"},
        scope_binding="",
        api_tool_definitions=definitions,
    )["api"]
    encoded = json.dumps(facts.model_facts)
    for secret in (
        "private-parameter-body",
        "private-account-version",
        "user:password",
        "private-key",
        "private-fragment",
    ):
        assert secret not in encoded
    assert "synthetic.example.invalid/invoices" in encoded
    assert facts.model_facts["parameters"]["amount"]["runtime_type"] == "string"


@pytest.mark.parametrize("marker", ["mocked", "agent", "restricted", "confirmed", "native_ref", "native_required"])
def test_missing_api_bindings_never_resolve_ordinary_with_surviving_marker(
    marker: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from core.tools.tool_manager import ToolManager
    from core.workflow.node_runtime import DifyToolNodeRuntime
    from graphon.nodes.tool.entities import ToolNodeData
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from runtime_contracts.builder.execution import BuilderExecutionContext, ConfirmedToolExecutionContext
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from tests.unit_tests.services.dify_builder.test_confirmed_full_run import prepared_agent_context
    from tests.unit_tests.services.dify_builder.test_execution_policy_service import _stored_context_values

    context = DifyRunContext(
        tenant_id="tenant", app_id="app", user_id="owner", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.DEBUGGER
    )
    if marker == "mocked":
        context.builder_mocked_node_ids = frozenset({"unrelated-builder-mocked-node"})
    elif marker == "agent":
        context.builder_agent_execution = prepared_agent_context()
    elif marker == "restricted":
        context.builder_execution = BuilderExecutionContext.model_validate(
            {
                **_stored_context_values(),
                "fixture_digest": "e" * 64,
                "context_digest": "f" * 64,
                "http_fixtures": (),
            }
        )
    elif marker == "confirmed":
        context.builder_execution = ConfirmedToolExecutionContext.model_validate(
            {
                **_stored_context_values(),
                "mode": "confirmed_tool",
                "policy_version": "builder-confirmed-gmail-read-v1",
                "context_digest": "f" * 64,
                "consent_id": "consent",
                "scope_digest": "e" * 64,
                "command_id": "command",
            }
        )
    elif marker == "native_ref":
        context.native_test_ref = NativeTestContextRef(
            request_id="request", invocation_id="invocation", context_digest="f" * 64
        )
    else:
        context.native_test_required = True
    data = api_graph()["nodes"][0]["data"]
    data.update(title="Invoice", provider_name="Synthetic", tool_label="Get invoice", tool_configurations={})

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        pytest.fail("Known Builder/native context reached ordinary Tool resolution without an API binding")

    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", forbidden)
    runtime = DifyToolNodeRuntime(context)
    with pytest.raises(ToolRuntimeResolutionError, match="api_tool_definition_stale"):
        runtime.get_runtime(node_id="api", node_data=ToolNodeData.model_validate(data), variable_pool=None)

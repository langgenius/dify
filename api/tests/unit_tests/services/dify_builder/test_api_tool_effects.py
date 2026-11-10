"""Custom API effect approval follows stored behavior through native Tool admission."""

from collections.abc import Mapping
from copy import deepcopy
from typing import Never

import httpx
import pytest
from sqlalchemy import Engine, Table

from core.dify_builder.models import Graph
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.utils.parser import ApiBasedToolSchemaParser
from graphon.node_events import NodeRunResult
from services.dify_builder.code_risk_assessment import assess_code, code_facts
from services.dify_builder.effect_disclosure import disclose
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase
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


@pytest.mark.parametrize(
    ("classification", "approve", "expected_calls", "drift"),
    [
        ("side_effect", False, 0, "none"),
        ("side_effect", True, 1, "none"),
        ("read", False, 1, "none"),
        ("unknown", False, 0, "none"),
        ("destructive", True, 0, "none"),
        ("unavailable", True, 0, "none"),
        ("side_effect", True, 0, "native_target"),
        ("side_effect", True, 0, "native_credentials"),
        ("side_effect", True, 0, "draft_parameter"),
        ("side_effect", True, 1, "lost_ack"),
        ("read", False, 1, "ordinary"),
        ("side_effect", True, 0, "missing_binding"),
    ],
)
def test_confirmation_to_native_tool_recording_transport(
    classification: str,
    approve: bool,
    expected_calls: int,
    drift: str,
    harness: FullRunCase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The local native-worker launcher runs real factory/ToolManager/ApiTool, with HTTP recorded only."""
    import json
    import time
    from dataclasses import dataclass
    from uuid import uuid4

    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from core.dify_builder.models import Actor, DifyBuilderContext
    from core.helper.provider_cache import NoOpProviderCredentialCache
    from core.helper.provider_encryption import ProviderConfigEncrypter
    from core.tools.entities.tool_entities import ApiProviderSchemaType
    from graphon.node_events import StreamCompletedEvent
    from graphon.runtime import InitParams, RuntimeState, VariablePool
    from models.tools import ApiToolProvider
    from services.dify_builder import code_risk_assessment
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.workflow_runtime.node_factory import DifyNodeFactory
    from tests.unit_tests.core.tools.test_tool_manager import _CallableSessionProxy
    from tests.unit_tests.services.dify_builder.test_code_risk_preparation import save_context
    from tests.unit_tests.services.dify_builder.test_confirmed_full_run import _run

    table = ApiToolProvider.__table__
    assert isinstance(table, Table)
    table.create(harness.factory.kw["bind"], checkfirst=True)
    with harness.factory.begin() as sql:
        provider = ApiToolProvider(
            name="Synthetic",
            icon="{}",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id="",
            tenant_id=harness.ids["tenant"],
            description="Synthetic",
            tools_str=json.dumps(
                [
                    bundle(
                        "Searches invoices without changing records."
                        if classification == "read"
                        else "Creates an invoice."
                    ).model_dump(mode="json")
                ]
            ),
            credentials_str='{"auth_type":"none"}',
        )
        sql.add(provider)
        sql.flush()
        provider_id = provider.id
    graph = api_graph()
    data = graph["nodes"][0]["data"]
    data.update(
        provider_id=provider_id,
        title="Invoice",
        provider_name="Synthetic",
        tool_label="Get invoice",
        tool_configurations={},
    )
    harness.draft.graph = json.dumps(graph)
    actor = Actor(account_id=harness.ids["account"], tenant_id=harness.ids["tenant"])
    context = DifyBuilderContext(goal_text="Review invoices", model_config={"name": "selected"})
    model_calls: list[dict[str, object]] = []

    def reason(facts: dict[str, object]) -> dict[str, str]:
        model_calls.append(facts)
        if classification == "unavailable":
            raise TimeoutError
        return {"classification": classification, "risk_notice": "Concrete operation behavior"}

    monkeypatch.setattr(code_risk_assessment, "builder_code_reasoner", lambda **_: reason)
    port = WorkflowServiceDifyPort()
    context.code_risk_assessments = port.prepare_code_risks(
        harness.ids["app"], actor, session_id=harness.ids["session"], inputs={"topic": "x"}, context=context
    )
    assert "api" in context.code_risk_assessments
    disclosure = port.disclose_effects(harness.ids["app"], actor, inputs={"topic": "x"}, code_risk_context=context)
    assert disclosure.items[0].tier == (
        "side_effect" if classification in {"unknown", "unavailable"} else classification
    )
    confirmation = disclosure.confirmation(["api"]) if approve else {}
    save_context(harness, context)
    requests: list[httpx.Request] = []
    completed: list[NodeRunResult] = []

    def record(request: httpx.Request) -> httpx.Response:
        from sqlalchemy.pool import QueuePool

        if drift != "ordinary":
            pool = harness.factory.kw["bind"].pool
            assert isinstance(pool, QueuePool)
            assert pool.checkedout() == 0
        requests.append(request)
        return httpx.Response(200, json={"synthetic": True})

    def encrypter(
        *, tenant_id: str, controller: ApiToolProviderController
    ) -> tuple[ProviderConfigEncrypter, NoOpProviderCredentialCache]:
        return ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[item.to_basic_provider_config() for item in controller.get_credentials_schema()],
            provider_config_cache=NoOpProviderCredentialCache(),
        ), NoOpProviderCredentialCache()

    @dataclass
    class Database:
        session: _CallableSessionProxy
        engine: Engine

    def native_worker(
        *,
        builder_mocked_node_ids: frozenset[str],
        builder_tool_credential_bindings: Mapping[str, str],
        builder_api_tool_bindings: Mapping[str, str],
        **_: object,
    ) -> dict[str, object]:
        if drift in {"native_target", "native_credentials"}:
            with harness.factory.begin() as sql:
                row = sql.get(ApiToolProvider, provider_id)
                assert row is not None
                if drift == "native_target":
                    changed = row.tools[0].model_dump(mode="json")
                    changed["server_url"] = "https://changed.example.invalid/invoices"
                    row.tools_str = json.dumps([changed])
                else:
                    row.credentials_str = '{"auth_type":"none","version":"changed"}'
        run_context = build_dify_run_context(
            tenant_id=harness.ids["tenant"],
            app_id=harness.ids["app"],
            user_id=harness.ids["account"],
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_mocked_node_ids=builder_mocked_node_ids,
            builder_tool_credential_bindings=None if drift == "ordinary" else builder_tool_credential_bindings,
            builder_api_tool_bindings=None if drift in {"ordinary", "missing_binding"} else builder_api_tool_bindings,
        )
        init = InitParams(workflow_id=harness.draft.id, graph_config=graph, run_context=run_context, call_depth=0)
        state = RuntimeState(workflow_id=harness.draft.id, variable_pool=VariablePool(), start_at=time.perf_counter())
        factory = DifyNodeFactory(init_params=init, runtime_state=state)
        node = factory.create_node(graph["nodes"][0])
        node.bind_execution_id(str(uuid4()))
        with harness.factory() as sql:
            monkeypatch.setattr(
                "core.tools.tool_manager.db", Database(_CallableSessionProxy(sql), harness.factory.kw["bind"])
            )
            outcome = node._run()
            if isinstance(outcome, NodeRunResult):
                completed.append(outcome)
            else:
                for event in outcome:
                    if isinstance(event, StreamCompletedEvent):
                        completed.append(event.node_run_result)
        if drift == "lost_ack":
            raise RuntimeError("lost local recording acknowledgement")
        return {"data": {"id": "native-recorded", "status": "succeeded"}}

    monkeypatch.setattr("core.tools.tool_manager.create_tool_provider_encrypter", encrypter)
    monkeypatch.setattr("core.db.session_factory.get_session_maker", lambda: harness.factory)
    with httpx.Client(transport=httpx.MockTransport(record)) as client:
        monkeypatch.setattr("core.helper.ssrf_proxy._get_ssrf_client", lambda _: client)
        harness.generate.side_effect = native_worker
        if drift == "draft_parameter":
            graph["nodes"][0]["data"]["tool_parameters"]["amount"]["value"] = 6
            harness.draft.graph = json.dumps(graph)
        first = _run(harness, confirmation)
        if drift == "draft_parameter":
            assert first.execution_refusal is not None
            assert first.execution_refusal.reason_code == "code_risk_assessment_stale"
            assert requests == []
            assert completed == []
            return
        assert first.execution_refusal is None
        assert len(requests) == expected_calls
        if requests:
            assert requests[0].method == "POST"
            assert str(requests[0].url) == "https://synthetic.example.invalid/invoices"
            assert json.loads(requests[0].content) == {"amount": 5}
        assert completed
        if drift in {"native_target", "native_credentials", "missing_binding"}:
            assert completed[0].status.value == "failed"
            assert "api_tool_definition_stale" in completed[0].error
        else:
            assert completed[0].status.value == "succeeded"
        if expected_calls == 0 and drift == "none":
            assert completed[0].process_data["builder_mocked"] is True
        repeated = _run(harness, confirmation)
        assert repeated.dify_run_id == first.dify_run_id
        if drift == "lost_ack":
            assert first.status == repeated.status == "running"
            assert first.dify_run_id == ""
            assert repeated.verification is not None
            assert repeated.verification.execution_evidence is not None
            assert repeated.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
        assert len(requests) == expected_calls
        assert len(model_calls) == 1


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

"""Strict runtime routes must stop ambiguous callers before service work."""

import base64
import json
from unittest.mock import patch

import pytest
from flask import Flask

from controllers.inner_api import bp
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.services.dify_builder import native_owner_fixtures as operation_fixtures
from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import resolved_context

operations_service = operation_fixtures.operations_service

ROUTES = [
    ("POST", "llm/invoke"),
    ("POST", "tools/invoke"),
    ("POST", "knowledge/retrieve"),
    ("POST", "files/upload-request"),
    ("POST", "files/download-request"),
    ("GET", "config/a/manifest"),
    ("GET", "config/a/skills/s/inspect"),
    ("POST", "config/a/download-request"),
    ("POST", "config/a/push"),
    ("PATCH", "config/a/env"),
    ("PUT", "config/a/note"),
    ("POST", "native-testing/prepare-run"),
    ("POST", "native-testing/prepared-config"),
    ("POST", "native-testing/before-call"),
    ("POST", "native-testing/outcome"),
    ("POST", "native-testing/materialize"),
    ("POST", "native-testing/claim-dispatch"),
    ("POST", "native-testing/prepare-intent"),
    ("POST", "native-testing/results"),
    ("POST", "native-testing/read-result"),
]


def selection(parent=None, generation=0):
    raw = json.dumps(
        {
            "agent_run_id": "run-1",
            "parent_node": parent,
            "request_digest": "a" * 64,
            "agent_generation": generation,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(bp)
    return app


@pytest.fixture(autouse=True)
def auth():
    with config_overrides_context(
        AGENT_BACKEND_API_TOKEN="agent-token",
        PLUGIN_DAEMON_KEY="daemon-key",
        INNER_API_KEY_FOR_PLUGIN="plugin-key",
    ):
        yield


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_registered_strict_route_refuses_missing_bearer(app, method, path):
    response = app.test_client().open("/inner/api/agent/runtime/" + path, method=method, json={})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Inner-Api-Key": "plugin-key"},
        {"Authorization": "Bearer wrong"},
        {"Authorization": "Basic agent-token"},
        {"Authorization": "Bearer agent-token", "X-Inner-Api-Key": "plugin-key"},
    ],
)
def test_strict_route_rejects_wrong_or_mixed_credentials(app, headers):
    response = app.test_client().post("/inner/api/agent/runtime/llm/invoke", json={}, headers=headers)
    assert response.status_code == 401


def test_strict_route_rejects_equal_agent_plugin_credentials(app):
    with config_overrides_context(AGENT_BACKEND_API_TOKEN="plugin-key"):
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke",
            json={},
            headers={"Authorization": "Bearer plugin-key"},
        )
    assert response.status_code == 401


@pytest.mark.parametrize("value", [None, "", "e30", "!", "a" * 6000])
def test_strict_route_requires_complete_bounded_selection(app, value):
    headers = {"Authorization": "Bearer agent-token"}
    if value is not None:
        headers["X-Dify-Agent-Run"] = value
    lineage = app.extensions["native_agent_endpoint_lineage"]
    with patch.object(
        lineage.backend,
        "read_run_identity_sync",
        side_effect=AssertionError("selection precedes private I/O"),
    ) as read:
        response = app.test_client().post("/inner/api/agent/runtime/llm/invoke", json={}, headers=headers)
    assert response.status_code == 409
    read.assert_not_called()


def test_strict_route_requires_installed_lineage_even_without_markers(app):
    app.extensions.pop("native_agent_endpoint_lineage", None)
    response = app.test_client().post(
        "/inner/api/agent/runtime/llm/invoke",
        json={},
        headers={
            "Authorization": "Bearer agent-token",
            "X-Dify-Agent-Run": selection(),
        },
    )
    assert response.status_code == 409


def test_legacy_rejects_explicit_native_envelope(app):
    with patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare") as prepare:
        response = app.test_client().post(
            "/inner/api/agent/llm/invoke",
            json={"native_dispatch": {}},
            headers={"X-Inner-Api-Key": "plugin-key"},
        )
    assert response.status_code == 409
    prepare.assert_not_called()


def encoded(model):
    raw = json.dumps(model.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_actual_native_identity_with_all_body_markers_removed_refuses_before_services(app, method, path):
    from contextlib import ExitStack

    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, phase = owner()
    app.extensions["native_agent_endpoint_lineage"] = lineage
    owners = [
        "controllers.inner_api.agent.llm.AgentLLMInnerService.prepare",
        "controllers.inner_api.agent.tools.AgentToolInnerService.invoke",
        "controllers.inner_api.knowledge.retrieval.InnerKnowledgeRetrievalService.retrieve",
        "controllers.inner_api.agent.files.get_signed_file_uri_for_plugin",
        "controllers.inner_api.agent.files.FileRequestService.request_download",
        "controllers.inner_api.plugin.agent_config.AgentConfigService",
        "core.db.session_factory.session_factory.create_session",
    ]
    with ExitStack() as stack:
        counters = [
            stack.enter_context(patch(path, side_effect=AssertionError("effect work before lineage")))
            for path in owners
        ]
        response = app.test_client().open(
            "/inner/api/agent/runtime/" + path,
            method=method,
            json={},
            headers={
                "Authorization": "Bearer agent-token",
                "X-Dify-Agent-Run": encoded(transport),
            },
        )
    initial_control = path in {
        "native-testing/prepare-run",
        "native-testing/prepared-config",
    }
    assert response.status_code == (400 if initial_control else 409)
    assert phase == ([] if initial_control else ["backend"])
    assert all(counter.call_count == 0 for counter in counters)


@pytest.mark.parametrize("native_markers", [False, True])
def test_private_read_failure_never_reaches_model_service(app, native_markers):
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, _phase = owner(parent=False, mutation="unavailable")
    app.extensions["native_agent_endpoint_lineage"] = lineage
    with patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare") as prepare:
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke",
            json={"native_dispatch": {}} if native_markers else {},
            headers={
                "Authorization": "Bearer agent-token",
                "X-Dify-Agent-Run": encoded(transport),
            },
        )
    assert response.status_code == 409
    prepare.assert_not_called()


@pytest.mark.parametrize("nullable_envelope", [False, True])
@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize(("owned_tenant", "status"), [("tenant-1", 200), ("foreign", 403)])
def test_genuine_plugin_and_verified_ordinary_retain_real_knowledge_resource_authorization(
    app, legacy, owned_tenant, status, nullable_envelope, sqlite_session, monkeypatch
):

    from tests.unit_tests.controllers.inner_api.test_knowledge_retrieval import _payload
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, phase = owner(parent=False)
    app.extensions["native_agent_endpoint_lineage"] = lineage
    accesses = []

    from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
    from models.dataset import Dataset
    from models.model import App

    sqlite_session.add_all(
        [
            App(
                id="app-1", tenant_id=owned_tenant, name="Caller", mode="workflow", enable_site=False, enable_api=False
            ),
            Dataset(id="dataset-1", tenant_id=owned_tenant, name="Knowledge", created_by="actor"),
        ]
    )
    sqlite_session.commit()
    scalar = sqlite_session.scalar
    scalars = sqlite_session.scalars

    def read_app(query):
        accesses.append("app")
        return scalar(query)

    def read_datasets(query):
        accesses.append("datasets")
        return scalars(query)

    monkeypatch.setattr(sqlite_session, "scalar", read_app)
    monkeypatch.setattr(sqlite_session, "scalars", read_datasets)
    monkeypatch.setattr(DatasetRetrieval, "knowledge_retrieval", lambda _self, **_kwargs: [])

    route = "/inner/api/knowledge/retrieve" if legacy else "/inner/api/agent/runtime/knowledge/retrieve"
    headers = (
        {"X-Inner-Api-Key": "plugin-key"}
        if legacy
        else {
            "Authorization": "Bearer agent-token",
            "X-Dify-Agent-Run": encoded(transport),
        }
    )
    with patch("core.db.session_factory.session_factory.create_session", lambda: sqlite_session):
        payload = _payload()
        if nullable_envelope:
            payload["native_dispatch"] = None
        response = app.test_client().post(route, json=payload, headers=headers)
    assert response.status_code == status
    assert accesses == (["app", "datasets"] if status == 200 else ["app"])
    assert phase == ([] if legacy else ["backend"])
    if status == 200:
        assert response.get_json()["results"] == []


@pytest.mark.parametrize(("path", "method"), [("config/a/manifest", "GET"), ("llm/invoke", "POST")])
def test_ordinary_private_identity_rejects_native_envelope_before_service(app, path, method):
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, _phase = owner(parent=False)
    app.extensions["native_agent_endpoint_lineage"] = lineage
    response = app.test_client().open(
        "/inner/api/agent/runtime/" + path,
        method=method,
        json={"native_dispatch": {}},
        headers={
            "Authorization": "Bearer agent-token",
            "X-Dify-Agent-Run": encoded(transport),
        },
    )
    assert response.status_code == 409


@pytest.mark.parametrize("mode", ["prepare-run", "prepared-config"])
def test_strict_initial_control_reaches_exact_s1_owner_without_effect_envelope(
    app, mode, operations_service, monkeypatch
):
    from services.dify_builder.native_testing.agent_preparation import (
        AgentPreparationService,
    )
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import (
        PARENT,
    )

    lineage, principal, transport, _phase = owner(unbound=True)
    app.extensions["native_agent_endpoint_lineage"] = lineage
    calls = []

    def load_prepared_config(**_kwargs):
        calls.append("read-config")
        return lineage.resolve(principal=principal, selection=transport, boundary="prepared-config", caller={}).config

    store = operations_service.state_store
    monkeypatch.setattr(store, "load_prepared_config", load_prepared_config)
    # Prepared-config uses the actual S1 read service. Bind uses the covered S1
    # service separately below, rather than manufacturing another create owner.
    if mode == "prepared-config":
        service = AgentPreparationService(
            state_store=store,
            backend=lineage.backend,
            workspace=None,
            config_builder=None,
        )
        body = {"parent_node": PARENT.model_dump(mode="json"), "config_ref": "cfg"}
    else:
        config = lineage.resolve(principal=principal, selection=transport, boundary="prepare-run", caller={}).config

        def bind_agent_run(**kwargs):
            calls.append(("bind", kwargs["association"].agent_run_id, kwargs["expected_invocation_generation"]))
            return "association"

        monkeypatch.setattr(store, "load_context", lambda **_kwargs: resolved_context())
        monkeypatch.setattr(store, "load_prepared_config", lambda **_kwargs: config)
        monkeypatch.setattr(store, "bind_agent_run", bind_agent_run)

        service = AgentPreparationService(
            state_store=store,
            backend=lineage.backend,
            workspace=None,
            config_builder=None,
        )
        body = {
            "parent_node": PARENT.model_dump(mode="json"),
            "agent_run_id": "run",
            "request_digest": "a" * 64,
        }
    with patch(
        "controllers.inner_api.agent.native_testing.agent_preparation_for_ref",
        return_value=service,
    ):
        response = app.test_client().post(
            "/inner/api/agent/runtime/native-testing/" + mode,
            json=body,
            headers={
                "Authorization": "Bearer agent-token",
                "X-Dify-Agent-Run": encoded(transport),
            },
        )
    assert response.status_code == 200
    assert calls == (["read-config"] if mode == "prepared-config" else [("bind", "run", 4)])


@pytest.mark.parametrize("token", [None, "", "   "])
def test_blank_agent_credential_never_authenticates(app, token):
    with config_overrides_context(AGENT_BACKEND_API_TOKEN=token):
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke",
            json={},
            headers={"Authorization": "Bearer agent-token"},
        )
    assert response.status_code == 401


@pytest.mark.parametrize(
    "raw",
    [
        b'{"agent_run_id":"run-1","parent_node":null,"request_digest":"'
        + b"a" * 64
        + b'","agent_generation":0,"agent_generation":0}',
        b"{}",
        b"[]",
        b"not-json",
    ],
)
def test_transport_selection_refuses_noncanonical_or_duplicate_key_json(app, raw):
    value = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    response = app.test_client().post(
        "/inner/api/agent/runtime/llm/invoke",
        json={},
        headers={"Authorization": "Bearer agent-token", "X-Dify-Agent-Run": value},
    )
    assert response.status_code == 409


def test_duplicate_selection_header_cannot_select_a_run(app):
    response = app.test_client().post(
        "/inner/api/agent/runtime/llm/invoke",
        json={},
        headers=[
            ("Authorization", "Bearer agent-token"),
            ("X-Dify-Agent-Run", selection()),
            ("X-Dify-Agent-Run", selection()),
        ],
    )
    assert response.status_code == 409


def test_legacy_plugin_route_never_accepts_agent_bearer(app):
    response = app.test_client().post(
        "/inner/api/knowledge/retrieve",
        json={},
        headers={
            "Authorization": "Bearer agent-token",
            "X-Dify-Agent-Run": selection(),
        },
    )
    assert response.status_code == 404


def test_runtime_schema_documents_its_distinct_bearer_and_selection(app):
    from controllers.inner_api import api

    with app.test_request_context():
        schema = api.__schema__
    operation = schema["paths"]["/agent/runtime/llm/invoke"]["post"]
    assert operation["security"] == [{"AgentBearer": []}]
    assert any(
        item["name"] == "X-Dify-Agent-Run" and item["in"] == "header" and item["required"]
        for item in operation.get("parameters", []) + schema["paths"]["/agent/runtime/llm/invoke"].get("parameters", [])
    )


@pytest.mark.parametrize("credential", ["INNER_API_KEY", "PLUGIN_DAEMON_KEY"])
def test_agent_bearer_refuses_equality_with_existing_enterprise_or_daemon_credential(app, credential):
    with config_overrides_context(AGENT_BACKEND_API_TOKEN="collision", **{credential: "collision"}):
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke",
            json={},
            headers={
                "Authorization": "Bearer collision",
                "X-Dify-Agent-Run": selection(),
            },
        )
    assert response.status_code == 401


def test_runtime_admission_cannot_leak_into_a_later_legacy_request_on_shared_app_context(
    app,
):
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, phase = owner(parent=False)
    app.extensions["native_agent_endpoint_lineage"] = lineage
    with app.app_context():
        client = app.test_client()
        strict = client.post(
            "/inner/api/agent/runtime/llm/invoke",
            json={},
            headers={
                "Authorization": "Bearer agent-token",
                "X-Dify-Agent-Run": encoded(transport),
            },
        )
        assert strict.status_code == 400
        legacy = client.post("/inner/api/agent/llm/invoke", json={})
        assert legacy.status_code == 404
    assert phase == ["backend"]


def test_control_handler_itself_cannot_consume_a_physical_permit(app):
    from controllers.inner_api.agent.native_testing import (
        AgentNativeControlRefused,
        AgentNativeDispatchClaimApi,
    )
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import REF

    body = {
        "ref": REF.model_dump(mode="json"),
        "intent": {
            "key": {"invocation_id": "inv", "occurrence_path": ["node"], "cursor": 0},
            "kind": "tool",
            "resource_ref": "tool",
            "implementation_revision": "revision",
            "account_ref": None,
            "target": {},
            "parameters": {},
            "input_digest": "a" * 64,
            "capability_digest": "b" * 64,
        },
        "permit": {
            "permit_id": "p",
            "attempt_id": "a",
            "operation_id": "o",
            "expires_at": "2099-01-01T00:00:00Z",
        },
    }
    with (
        app.test_request_context(json=body),
        patch("controllers.inner_api.agent.native_testing.agent_bridge_for_ref") as bridge,
        pytest.raises(AgentNativeControlRefused),
    ):
        AgentNativeDispatchClaimApi.post.__wrapped__(AgentNativeDispatchClaimApi())
    bridge.assert_not_called()


def test_run_bound_claim_route_reaches_shell_owner_only_after_exact_lineage(app, operations_service, monkeypatch):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    lineage, _principal, transport, _phase = owner()
    app.extensions["native_agent_endpoint_lineage"] = lineage
    wire = envelope()

    def claim(*, envelope):
        if envelope.intent.kind != "shell":
            raise BuilderExecutionPolicyError("native_agent_boundary_unavailable")

    monkeypatch.setattr(operations_service, "claim_shell_dispatch", claim)
    with patch(
        "controllers.inner_api.agent.native_testing.agent_operations_for_ref",
        return_value=operations_service,
    ):
        headers = {"Authorization": "Bearer agent-token", "X-Dify-Agent-Run": encoded(transport)}
        payload = wire.model_dump(mode="json")
        payload["ref"] = transport.parent_node.ref.model_dump(mode="json")
        payload["intent"]["kind"] = "shell"
        response = app.test_client().post(
            "/inner/api/agent/runtime/native-testing/claim-dispatch", json=payload, headers=headers
        )
        assert response.status_code == 200
        assert response.json == {"claimed": True}
        payload["intent"]["kind"] = "model"
        assert (
            app.test_client()
            .post("/inner/api/agent/runtime/native-testing/claim-dispatch", json=payload, headers=headers)
            .status_code
            == 409
        )


@pytest.mark.parametrize(
    ("scenario", "expected_status"),
    [
        ("current_bound", 200),
        ("wrong_generation", 409),
        ("stale_owner", 409),
        ("unbound", 409),
        ("prepare_run", 409),
        ("foreign_parent", 409),
        ("config_drift", 409),
    ],
)
def test_registered_resumed_config_read_requires_current_bound_exact_owner(app, scenario, expected_status):
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
    from tests.unit_tests.services.dify_builder.test_agent_preparation_owner import PARENT

    mutation = {
        "wrong_generation": "generation",
        "stale_owner": "owner",
        "foreign_parent": "parent",
        "config_drift": "config",
    }.get(scenario)
    lineage, _principal, transport, _phase = owner(unbound=scenario == "unbound", mutation=mutation)
    backend = lineage.backend

    class ResumedBackend:
        def read_run_identity_sync(self, run_id, query):
            actual = backend.read_run_identity_sync(run_id, query)
            return actual.model_copy(update={"agent_generation": actual.agent_generation + 1})

    lineage.backend = ResumedBackend()
    transport = transport.model_copy(update={"agent_generation": 1})
    app.extensions["native_agent_endpoint_lineage"] = lineage
    calls = []
    store = lineage.preparation_for_ref(PARENT.ref).state_store
    read = store.load_prepared_config

    class ReadStore:
        def load_prepared_config(self, **kwargs):
            calls.append("read-current-config")
            return read(**kwargs)

    service = AgentPreparationService(
        state_store=ReadStore(), backend=lineage.backend, workspace=None, config_builder=None
    )
    boundary = "prepare-run" if scenario == "prepare_run" else "prepared-config"
    body = {"parent_node": PARENT.model_dump(mode="json"), "config_ref": "cfg"}
    if boundary == "prepare-run":
        body = {"parent_node": PARENT.model_dump(mode="json"), "agent_run_id": "run", "request_digest": "a" * 64}
    with patch("controllers.inner_api.agent.native_testing.agent_preparation_for_ref", return_value=service):
        response = app.test_client().post(
            "/inner/api/agent/runtime/native-testing/" + boundary,
            json=body,
            headers={"Authorization": "Bearer agent-token", "X-Dify-Agent-Run": encoded(transport)},
        )
    assert response.status_code == expected_status
    assert calls == (["read-current-config"] if expected_status == 200 else [])
    if expected_status == 200:
        assert response.json["config_ref"] == "cfg"
        assert response.json["parent_node"] == PARENT.model_dump(mode="json")


@pytest.mark.parametrize("reason", ["native_agent_risk_assessment_unavailable", "private-token-and-call-arguments"])
def test_prepare_intent_refusal_logs_only_bounded_policy_category(app, caplog, reason, operations_service, monkeypatch):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    lineage, _principal, transport, _phase = owner()
    app.extensions["native_agent_endpoint_lineage"] = lineage
    wire = envelope()
    body = {
        "ref": transport.parent_node.ref.model_dump(mode="json"),
        "key": wire.intent.key.model_dump(mode="json"),
        "boundary": "core_tool",
        "target": {"provider_type": "builtin", "provider_id": "configured", "tool_name": "parse"},
        "parameters": {"content": "private-call-content"},
    }

    def refused(**_kwargs):
        raise BuilderExecutionPolicyError(reason)

    monkeypatch.setattr(operations_service, "prepare_intent", refused)
    with (
        patch(
            "controllers.inner_api.agent.native_testing.agent_operations_for_ref",
            return_value=operations_service,
        ),
        caplog.at_level("WARNING"),
    ):
        response = app.test_client().post(
            "/inner/api/agent/runtime/native-testing/prepare-intent",
            json=body,
            headers={"Authorization": "Bearer agent-token", "X-Dify-Agent-Run": encoded(transport)},
        )
    assert response.status_code == 409
    assert response.json["code"] == "native_agent_control_refused"
    expected = (
        "native_agent_risk_assessment_unavailable"
        if reason.startswith("native_agent_")
        else "native_agent_control_refused"
    )
    assert "Native Agent prepare-intent refused: " + expected in caplog.text
    assert "private-token-and-call-arguments" not in caplog.text
    assert "private-call-content" not in caplog.text

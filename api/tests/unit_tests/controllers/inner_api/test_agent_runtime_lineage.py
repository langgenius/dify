"""Strict runtime routes must stop ambiguous callers before service work."""

import base64
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from controllers.inner_api import bp
from flask import Flask

from tests.unit_tests.config_override import config_overrides_context

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


@pytest.mark.parametrize("method,path", ROUTES)
def test_registered_strict_route_refuses_missing_bearer(app, method, path):
    response = app.test_client().open(
        "/inner/api/agent/runtime/" + path, method=method, json={}
    )
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
    response = app.test_client().post(
        "/inner/api/agent/runtime/llm/invoke", json={}, headers=headers
    )
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
        response = app.test_client().post(
            "/inner/api/agent/runtime/llm/invoke", json={}, headers=headers
        )
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
    with patch(
        "controllers.inner_api.agent.llm.AgentLLMInnerService.prepare"
    ) as prepare:
        response = app.test_client().post(
            "/inner/api/agent/llm/invoke",
            json={"native_dispatch": {}},
            headers={"X-Inner-Api-Key": "plugin-key"},
        )
    assert response.status_code == 409
    prepare.assert_not_called()


def encoded(model):
    raw = json.dumps(
        model.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.mark.parametrize("method,path", ROUTES)
def test_actual_native_identity_with_all_body_markers_removed_refuses_before_services(
    app, method, path
):
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
            stack.enter_context(
                patch(path, side_effect=AssertionError("effect work before lineage"))
            )
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
    with patch(
        "controllers.inner_api.agent.llm.AgentLLMInnerService.prepare"
    ) as prepare:
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
@pytest.mark.parametrize("owned_tenant,status", [("tenant-1", 200), ("foreign", 403)])
def test_genuine_plugin_and_verified_ordinary_retain_real_knowledge_resource_authorization(
    app, legacy, owned_tenant, status, nullable_envelope
):
    from contextlib import contextmanager

    from tests.unit_tests.controllers.inner_api.test_knowledge_retrieval import _payload
    from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner

    lineage, _principal, transport, phase = owner(parent=False)
    app.extensions["native_agent_endpoint_lineage"] = lineage
    accesses = []

    class SQL:
        def scalar(self, query):
            accesses.append("app")
            return SimpleNamespace(id="app-1", tenant_id=owned_tenant)

        def scalars(self, query):
            accesses.append("datasets")
            return SimpleNamespace(
                all=lambda: [SimpleNamespace(id="dataset-1", tenant_id=owned_tenant)]
            )

        def commit(self):
            pass

        def rollback(self):
            pass

    @contextmanager
    def sql():
        yield SQL()

    usage = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "prompt_unit_price": "0",
        "completion_unit_price": "0",
        "prompt_price_unit": "0",
        "completion_price_unit": "0",
        "prompt_price": "0",
        "completion_price": "0",
        "total_price": "0",
        "latency": 0,
    }
    rag = SimpleNamespace(knowledge_retrieval=lambda **kwargs: [], llm_usage=usage)
    route = (
        "/inner/api/knowledge/retrieve"
        if legacy
        else "/inner/api/agent/runtime/knowledge/retrieve"
    )
    headers = (
        {"X-Inner-Api-Key": "plugin-key"}
        if legacy
        else {
            "Authorization": "Bearer agent-token",
            "X-Dify-Agent-Run": encoded(transport),
        }
    )
    with (
        patch("core.db.session_factory.session_factory.create_session", sql),
        patch(
            "services.knowledge_retrieval_inner_service.DatasetRetrieval",
            return_value=rag,
        ),
    ):
        payload = _payload()
        if nullable_envelope:
            payload["native_dispatch"] = None
        response = app.test_client().post(route, json=payload, headers=headers)
    assert response.status_code == status
    assert accesses == (["app", "datasets"] if status == 200 else ["app"])
    assert phase == ([] if legacy else ["backend"])
    if status == 200:
        assert response.get_json()["results"] == []


@pytest.mark.parametrize(
    "path,method", [("config/a/manifest", "GET"), ("llm/invoke", "POST")]
)
def test_ordinary_private_identity_rejects_native_envelope_before_service(
    app, path, method
):
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
    app, mode
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

    class Store:
        def load_prepared_config(self, **kwargs):
            calls.append("read-config")
            return lineage.resolve(
                principal=principal,
                selection=transport,
                boundary="prepared-config",
                caller={},
            ).config

    # Prepared-config uses the actual S1 read service. Bind uses the covered S1
    # service separately below, rather than manufacturing another create owner.
    if mode == "prepared-config":
        service = AgentPreparationService(
            state_store=Store(),
            backend=lineage.backend,
            workspace=None,
            config_builder=None,
        )
        body = {"parent_node": PARENT.model_dump(mode="json"), "config_ref": "cfg"}
    else:
        config = lineage.resolve(
            principal=principal, selection=transport, boundary="prepare-run", caller={}
        ).config

        class BindStore:
            def load_context(self, **kwargs):
                return SimpleNamespace(generation=4)

            def load_prepared_config(self, **kwargs):
                return config

            def bind_agent_run(self, **kwargs):
                calls.append(
                    (
                        "bind",
                        kwargs["association"].agent_run_id,
                        kwargs["expected_invocation_generation"],
                    )
                )
                return "association"

        service = AgentPreparationService(
            state_store=BindStore(),
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
    assert calls == (
        ["read-config"] if mode == "prepared-config" else [("bind", "run", 4)]
    )


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
        item["name"] == "X-Dify-Agent-Run"
        and item["in"] == "header"
        and item["required"]
        for item in operation.get("parameters", [])
        + schema["paths"]["/agent/runtime/llm/invoke"].get("parameters", [])
    )


@pytest.mark.parametrize("credential", ["INNER_API_KEY", "PLUGIN_DAEMON_KEY"])
def test_agent_bearer_refuses_equality_with_existing_enterprise_or_daemon_credential(
    app, credential
):
    with config_overrides_context(
        AGENT_BACKEND_API_TOKEN="collision", **{credential: "collision"}
    ):
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
        patch(
            "controllers.inner_api.agent.native_testing.agent_bridge_for_ref"
        ) as bridge,
        pytest.raises(AgentNativeControlRefused),
    ):
        AgentNativeDispatchClaimApi.post.__wrapped__(AgentNativeDispatchClaimApi())
    bridge.assert_not_called()

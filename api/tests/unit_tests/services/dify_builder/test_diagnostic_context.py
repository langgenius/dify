import json
from collections.abc import Sequence
from copy import deepcopy
from typing import Literal

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor, Graph, NodeOutput, Run
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from models.model import App, AppMode
from models.workflow import Workflow
from services.dify_builder.agent import llm
from services.dify_builder.credentials import REDACTED
from services.dify_builder.diagnostic_context import redact_run_context
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.revision import execution_revision
from services.dify_builder.task_controls import ExecutionFence, draft_binding, execution_scope
from services.workflow_service import WorkflowService


@pytest.mark.parametrize("field", ["api_key", "apiKey", "X-Api-Key", "access_token", "client_secret", "password"])
def test_nested_sensitive_fields_are_redacted_without_hiding_ordinary_key(field: str) -> None:
    output = NodeOutput(inputs={"items": [{field: "runtime-private", "key": "lookup", "count": 0, "enabled": False}]})
    run = Run(per_node=[output], immutable=True)
    before = deepcopy((run, output))

    safe_run, safe_outputs = redact_run_context(run, {}, [output])

    assert safe_outputs[0].inputs == {"items": [{field: REDACTED, "key": "lookup", "count": 0, "enabled": False}]}
    assert safe_run.per_node == safe_outputs
    safe_outputs[0].inputs["items"][0]["key"] = "changed"
    assert (run, output) == before


@pytest.mark.parametrize(
    ("field", "value"),
    [
        (
            "authorization",
            {"type": "api-key", "config": {"type": "bearer", "api_key": "graph-private", "header": "X-Key"}},
        ),
        ("headers", "X-Custom: graph-private\nEmpty:"),
        ("headers", "graph-private"),
        ("headers", {"X-Custom": "graph-private"}),
        ("headers", [{"key": "X-Custom", "value": "graph-private"}]),
        ("params", "session:graph-private"),
        ("query", {"session": "graph-private"}),
        ("query", "session=graph-private&empty="),
        ("query", "session=graph%2Dprivate"),
        ("query", "graph-private"),
        ("api_key", "graph-private"),
    ],
)
def test_graph_credentials_repeated_in_run_and_output_text_are_removed(
    field: str, value: Graph | list[Graph] | str
) -> None:
    graph = {"nodes": [{"id": "http1", "data": {field: value}}]}
    output = NodeOutput(
        error="connection refused: graph-private", outputs={"body": "graph-private rejected", "status": 401}
    )
    run = Run(error="launch failed: graph-private", per_node=[output])
    before = deepcopy((run, graph, output))

    safe_run, safe_outputs = redact_run_context(run, graph, [output])

    assert safe_run.error == f"launch failed: {REDACTED}"
    assert safe_outputs[0].error == f"connection refused: {REDACTED}"
    assert safe_outputs[0].outputs == {"body": f"{REDACTED} rejected", "status": 401}
    assert (run, graph, output) == before


def test_authorization_scheme_is_removed_when_only_the_token_repeats_in_error() -> None:
    graph = {"nodes": [{"data": {"headers": "Authorization: Bearer auth-private"}}]}

    safe_run, _ = redact_run_context(Run(error="connection refused: auth-private"), graph, [])

    assert safe_run.error == f"connection refused: {REDACTED}"


def test_falsey_diagnostic_values_are_preserved_in_independent_copies() -> None:
    output = NodeOutput(inputs={"empty": "", "null": None, "zero": 0, "false": False, "list": [], "dict": {}})

    safe_run, safe_outputs = redact_run_context(Run(per_node=[output]), {}, [output])

    assert safe_outputs[0] == output
    assert safe_outputs[0] is not output
    assert safe_run.per_node[0] is not output


def test_overlapping_credentials_do_not_leave_a_suffix_in_free_text() -> None:
    graph = {"nodes": [{"data": {"api_key": "private", "password": "private-long"}}]}

    safe_run, _ = redact_run_context(Run(error="private-long refused private"), graph, [])

    assert safe_run.error == f"{REDACTED} refused {REDACTED}"


def test_short_graph_credential_does_not_corrupt_an_inserted_sentinel() -> None:
    graph = {"nodes": [{"data": {"api_key": "private-long", "password": "DIFY"}}]}

    safe_run, _ = redact_run_context(Run(error="private-long refused DIFY"), graph, [])

    assert safe_run.error == f"{REDACTED} refused {REDACTED}"


def test_structured_redaction_preserves_exact_sentinels_when_a_credential_matches_part_of_them() -> None:
    output = NodeOutput(
        inputs={"api_key": "DIFY", "nested": [{"password": "DIFY"}]},
        outputs={"headers": "Authorization: DIFY", "body": f"existing {REDACTED}; rejected DIFY"},
    )
    run = Run(per_node=[output], immutable=True)
    before = deepcopy((run, output))

    safe_run, safe_outputs = redact_run_context(run, {}, [output])

    assert safe_outputs[0].inputs == {"api_key": REDACTED, "nested": [{"password": REDACTED}]}
    assert safe_outputs[0].outputs == {
        "headers": f"Authorization:{REDACTED}",
        "body": f"existing {REDACTED}; rejected {REDACTED}",
    }
    assert safe_run.per_node == safe_outputs
    assert (run, output) == before


def _private_dsl() -> Graph:
    return {
        "graph": {
            "nodes": [
                {
                    "id": "http",
                    "data": {
                        "type": "http-request",
                        "headers": "X-Key: SYNTHETIC_HEADER_SECRET",
                        "body": {
                            "type": "json",
                            "data": [
                                {"key": "", "type": "text", "value": '{"token":"SYNTHETIC_BODY_SECRET","amount":31}'}
                            ],
                        },
                        "nested": [{"password": "SYNTHETIC_NESTED_SECRET"}],
                    },
                },
                {
                    "id": "code",
                    "data": {"type": "code", "code": 'api_key = "SYNTHETIC_CODE_SECRET"\namount = 31\n'},
                },
            ],
            "edges": [],
        },
        "features": {
            "echo": "SYNTHETIC_HEADER_SECRET SYNTHETIC_ENV_SECRET SYNTHETIC_NESTED_SECRET",
            "business": {"description": "business-data-retained", "zero": 0, "enabled": False, "null": None},
        },
        "environment_variables": [
            {
                "id": "12345678-1234-1234-1234-123456789012",
                "name": "service",
                "value_type": "secret",
                "value": "SYNTHETIC_ENV_SECRET",
            }
        ],
        "conversation_variables": [{"name": "echo", "value": "SYNTHETIC_BODY_SECRET SYNTHETIC_CODE_SECRET"}],
    }


@pytest.fixture
def captured_private_dsl(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> tuple[Graph, Workflow]:
    """Read an owned persisted draft; replace only the external decryption boundary."""
    raw = _private_dsl()
    workflow = Workflow.new(
        tenant_id="privacy-tenant",
        app_id="privacy-app",
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(raw["graph"]),
        features=json.dumps(raw["features"]),
        created_by="privacy-actor",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow._environment_variables = json.dumps(
        {"service": {**raw["environment_variables"][0], "value": "encrypted-synthetic-value"}}
    )

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == "privacy-tenant"
        assert token == "encrypted-synthetic-value"
        return "SYNTHETIC_ENV_SECRET"

    monkeypatch.setattr("core.workflow.environment_variables.encrypter.decrypt_token", decrypt)
    factory = sessionmaker(sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr("services.dify_builder.dify_port._session_factory", lambda: factory)
    monkeypatch.setattr("services.dify_builder.dify_port.WorkflowService", lambda: WorkflowService(factory))
    with factory() as sql, sql.begin():
        sql.add(
            App(
                id="privacy-app",
                tenant_id="privacy-tenant",
                name="Privacy",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        sql.add(workflow)
    before = (workflow.graph, workflow.features, workflow._environment_variables, workflow._conversation_variables)
    binding = draft_binding(workflow)
    revision = execution_revision(workflow)

    dsl, actual_revision = WorkflowServiceDifyPort().read_task_dsl(
        "privacy-app", Actor(account_id="privacy-actor", tenant_id="privacy-tenant")
    )

    assert actual_revision == revision
    assert dsl["_draft_binding"] == {"workflow_id": workflow.id, "digest": binding}
    assert before == (
        workflow.graph,
        workflow.features,
        workflow._environment_variables,
        workflow._conversation_variables,
    )
    with factory() as sql:
        persisted = sql.get(Workflow, workflow.id)
        assert persisted is not None
        assert before == (
            persisted.graph,
            persisted.features,
            persisted._environment_variables,
            persisted._conversation_variables,
        )
    return dsl, workflow


def _assert_safe_dsl(dsl: Graph) -> None:
    encoded = json.dumps(dsl)
    for kind in ("BODY", "CODE", "NESTED", "HEADER", "ENV"):
        assert f"SYNTHETIC_{kind}_SECRET" not in encoded
    assert dsl["features"]["business"] == {
        "description": "business-data-retained",
        "zero": 0,
        "enabled": False,
        "null": None,
    }
    body = dsl["graph"]["nodes"][0]["data"]["body"]["data"][0]["value"]
    assert json.loads(body) == {"token": REDACTED, "amount": 31}
    assert dsl["graph"]["nodes"][1]["data"]["code"] == f'api_key = "{REDACTED}"\namount = 31\n'
    assert dsl["environment_variables"][0]["value"] == REDACTED


def test_read_task_dsl_withholds_body_code_nested_and_known_echoes(
    captured_private_dsl: tuple[Graph, Workflow],
) -> None:
    dsl, workflow = captured_private_dsl
    _assert_safe_dsl(dsl)
    dsl["graph"]["nodes"][0]["data"]["body"]["data"][0]["value"] = "changed"
    assert "SYNTHETIC_BODY_SECRET" in workflow.graph


@pytest.mark.parametrize("path", ["text", "stream", "json"])
@pytest.mark.parametrize("snapshot", ["historical", "fresh", "sanitized"])
def test_final_prompt_projects_synchronized_dsl_without_mutating_snapshot(
    path: Literal["text", "stream", "json"],
    snapshot: Literal["historical", "fresh", "sanitized"],
    captured_private_dsl: tuple[Graph, Workflow],
) -> None:
    from services.dify_builder.diagnostic_context import redact_diagnostic_value

    fresh, workflow = captured_private_dsl
    historical = _private_dsl()
    # Caller diagnostic sanitation has already happened before final assembly.
    caller = redact_diagnostic_value(
        {"note": "safe caller context SYNTHETIC_BODY_SECRET SYNTHETIC_CODE_SECRET"},
        Run(immutable=True),
        historical["graph"],
        [],
    )
    assert "SYNTHETIC_BODY_SECRET" not in json.dumps(caller)
    assert "SYNTHETIC_CODE_SECRET" not in json.dumps(caller)
    dsl = historical if snapshot == "historical" else fresh
    if snapshot == "sanitized":
        dsl = redact_diagnostic_value(fresh, Run(), fresh["graph"], [])
    before = deepcopy(dsl)
    raw_graph = workflow.graph
    prompts: list[PromptMessage] = []

    class Model:
        def invoke_llm(self, *, prompt_messages: Sequence[PromptMessage], **_kwargs: object) -> LLMResult:
            prompts.extend(prompt_messages)
            return LLMResult(
                model="privacy-recording",
                message=AssistantPromptMessage(content='{"ok":true}'),
                usage=LLMUsage.empty_usage(),
            )

    with execution_scope(ExecutionFence("privacy-session", 0, lambda: None, dsl)):
        if path == "text":
            assert llm.invoke_text(Model(), system="system", user=json.dumps(caller)) == '{"ok":true}'
        elif path == "stream":
            assert list(llm.invoke_text_stream(Model(), system="system", user=json.dumps(caller))) == ['{"ok":true}']
        else:
            assert llm.invoke_json(Model(), system="system", user=json.dumps(caller)) == {"ok": True}

    content = prompts[-1].content
    assert isinstance(content, str)
    assert "safe caller context" in content
    safe = json.loads(content.split("CURRENT SYNCHRONIZED WORKFLOW DSL:\n", 1)[1])
    _assert_safe_dsl(safe)
    assert dsl == before
    assert workflow.graph == raw_graph

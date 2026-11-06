"""Repair prompts must contain complete bounded source, never imagined tails."""

import json
from copy import deepcopy

import pytest

from core.dify_builder.models import Diagnosis, Graph, NodeOutput, Run
from services.dify_builder.agent import fix
from services.dify_builder.condition_evidence import build_evidence
from tests.helpers.unit.core.model_fixtures import make_model_instance


def _repair_prompt(monkeypatch: pytest.MonkeyPatch, graph: Graph) -> str:
    prompts: list[str] = []

    def answer(_model: object, *, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append(user)
        return {"intents": [], "risk": {"level": "low", "reason": "Needs review"}}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)
    fix.propose_repair(
        make_model_instance(provider="openai", model="test-model"),
        Diagnosis(culprit_node_id="culprit", root_cause="bad parser"),
        graph,
    )
    return prompts[0]


@pytest.mark.parametrize("node_type", ["code", "tool"])
def test_repair_prompt_preserves_long_culprit_source_and_binding_contract(
    monkeypatch: pytest.MonkeyPatch, node_type: str
) -> None:
    """A compact node budget must not hide the source a repair must replace."""
    source = "# parse every business field\n" * 150 + "def main(text):\n    return {'result': text}\n"
    data: dict[str, object] = {
        "type": node_type,
        "title": "Parser",
        "code": source,
        "code_language": "python3",
        "variables": [{"variable": "text", "value_selector": ["extract", "text"]}],
        "outputs": {"result": {"type": "string", "children": None}},
    }
    if node_type == "tool":
        data["tool_parameters"] = {"code": {"type": "mixed", "value": source}}
        data.pop("code")
    graph: Graph = {"nodes": [{"id": "culprit", "data": data}], "edges": []}
    original = deepcopy(graph)

    prompt = _repair_prompt(monkeypatch, graph)

    assert json.dumps(source, ensure_ascii=False) in prompt
    assert json.dumps(data["variables"], ensure_ascii=False) in prompt
    assert json.dumps(data["outputs"], ensure_ascii=False) in prompt
    assert graph == original


def test_repair_prompt_names_oversized_source_without_showing_an_incomplete_fragment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "code": "SOURCE_MUST_BE_WHOLE" + "x" * 100_000,
                    "code_language": "python3",
                    "variables": [{"variable": "text", "value_selector": ["extract", "text"]}],
                    "outputs": {"result": {"type": "string"}},
                },
            }
        ],
        "edges": [],
    }

    prompt = _repair_prompt(monkeypatch, graph)

    assert "SOURCE_MUST_BE_WHOLE" not in prompt
    assert '"characters": 100020' in prompt
    assert '"outputs": {"result": {"type": "string"}}' in prompt
    assert "Do not reconstruct or replace omitted fields" in prompt
    assert len(prompt) < 40_000


def test_expanded_repair_context_uses_only_redacted_culprit_config(monkeypatch: pytest.MonkeyPatch) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "code": "# safe parser\n" * 150,
                    "authorization": {"type": "api-key", "config": {"api_key": "private-token"}},
                    "headers": "Authorization: private-header",
                },
            },
            {"id": "other", "data": {"type": "code", "code": "NEIGHBOR_SOURCE_MUST_STAY_PRIVATE"}},
        ],
        "edges": [],
    }

    prompt = _repair_prompt(monkeypatch, graph)

    assert "private-token" not in prompt
    assert "private-header" not in prompt
    assert json.dumps("# safe parser\n" * 150) in prompt
    assert "NEIGHBOR_SOURCE_MUST_STAY_PRIVATE" not in prompt


@pytest.mark.parametrize(("repetitions", "included"), [(1000, True), (10_000, False)])
def test_repair_source_budget_counts_utf8_bytes(
    monkeypatch: pytest.MonkeyPatch, repetitions: int, included: bool
) -> None:
    source = "# 中文表头\n" * repetitions
    graph: Graph = {"nodes": [{"id": "culprit", "data": {"type": "code", "code": source}}], "edges": []}

    prompt = _repair_prompt(monkeypatch, graph)

    assert (json.dumps(source, ensure_ascii=False) in prompt) is included
    assert len(prompt.encode("utf-8")) < 40_000


def test_repair_source_surrogate_is_json_escaped(monkeypatch: pytest.MonkeyPatch) -> None:
    source = "# parser\n" * 200 + "value = '\ud800'"
    graph: Graph = {"nodes": [{"id": "culprit", "data": {"type": "code", "code": source}}], "edges": []}

    prompt = _repair_prompt(monkeypatch, graph)

    assert "\\ud800" in prompt
    prompt.encode("utf-8")


def test_preflight_correction_keeps_complete_source_in_both_repair_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    source = "# complete parser context\n" * 150 + "def main():\n    return {'result': 'old'}\n"
    repaired = "def main():\n    return {'result': 'fixed'}\n"
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "title": "Parser",
                    "code": source,
                    "code_language": "python3",
                    "variables": [],
                    "outputs": {"result": {"type": "string"}},
                },
            }
        ],
        "edges": [],
    }
    prompts: list[str] = []

    def answer(_model: object, *, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append(user)
        args = (
            {"node_id": "culprit", "path": "code_language", "value": "invalid-language"}
            if len(prompts) == 1
            else {"node_id": "culprit", "path": "code", "value": repaired}
        )
        return {"intents": [{"op": "set_node_config", "args": args}], "risk": {"level": "low"}}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)

    intents, _risk = fix.propose_repair(
        make_model_instance(provider="openai", model="test-model"), Diagnosis(culprit_node_id="culprit"), graph
    )

    assert len(prompts) == 2
    assert all(json.dumps(source, ensure_ascii=False) in prompt for prompt in prompts)
    assert [(intent.op, intent.args) for intent in intents] == [
        ("set_node_config", {"node_id": "culprit", "path": "code", "value": repaired})
    ]
    assert graph["nodes"][0]["data"]["code"] == source


@pytest.mark.parametrize(
    ("node_type", "path"), [("code", "code"), ("tool", "tool_parameters"), ("tool", "tool_parameters.code.value")]
)
@pytest.mark.parametrize("attempt", [1, 2])
def test_repair_cannot_replace_a_field_omitted_from_its_context(
    monkeypatch: pytest.MonkeyPatch, node_type: str, path: str, attempt: int
) -> None:
    source = "# original parser\n" * 3000 + "def main():\n    return {'result': 'old'}\n"
    data: dict[str, object] = {
        "type": node_type,
        "title": "Parser",
        "code": source,
        "code_language": "python3",
        "variables": [],
        "outputs": {"result": {"type": "string"}},
    }
    if node_type == "tool":
        data.update(
            {
                "provider_id": "code",
                "provider_name": "code",
                "provider_type": "builtin",
                "tool_name": "simple_code",
                "tool_label": "Code",
                "tool_configurations": {},
            }
        )
        data["tool_parameters"] = {"code": {"type": "mixed", "value": source}}
        data.pop("code")
    graph: Graph = {"nodes": [{"id": "culprit", "data": data}], "edges": []}
    original = deepcopy(graph)
    prompts: list[str] = []

    def answer(_model: object, *, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append(user)
        guessed = "def main():\n    return {'result': 'guessed'}\n"
        value = {"code": {"type": "mixed", "value": guessed}} if path == "tool_parameters" else guessed
        args: dict[str, object] = {"node_id": "culprit", "path": path, "value": value}
        if attempt == 2 and len(prompts) == 1:
            args = {"node_id": "culprit", "path": "", "value": {}}
        return {"intents": [{"op": "set_node_config", "args": args}], "risk": {"level": "low"}}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)

    intents, risk = fix.propose_repair(
        make_model_instance(provider="openai", model="test-model"), Diagnosis(culprit_node_id="culprit"), graph
    )

    assert intents == []
    assert risk.level == "high"
    assert len(prompts) == 2
    assert graph == original


def test_omitted_source_does_not_block_a_visible_unrelated_field_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "title": "Parser",
                    "code": "# original\n" * 3000,
                    "code_language": "python3",
                    "variables": [],
                    "outputs": {},
                },
            }
        ],
        "edges": [],
    }

    def answer(_model: object, **_kwargs: object) -> dict[str, object]:
        return {
            "intents": [
                {"op": "set_node_config", "args": {"node_id": "culprit", "path": "title", "value": "Updated parser"}}
            ],
            "risk": {"level": "low"},
        }

    monkeypatch.setattr(fix.llm, "invoke_json", answer)

    intents, _risk = fix.propose_repair(
        make_model_instance(provider="openai", model="test-model"), Diagnosis(culprit_node_id="culprit"), graph
    )

    assert [(intent.args["path"], intent.args["value"]) for intent in intents] == [("title", "Updated parser")]


def _diagnosis_prompt(
    monkeypatch: pytest.MonkeyPatch, graph: Graph, outputs: list[NodeOutput], evidence: dict[str, object]
) -> str:
    prompts: list[str] = []

    def answer(_model: object, *, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append(user)
        return {"culprit_node_id": "culprit", "root_cause": "Review parser assumptions", "severity": "high"}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)
    fix.diagnose(
        make_model_instance(provider="openai", model="test-model"),
        Run(status="failed"),
        graph,
        outputs,
        evidence=evidence,
    )
    return prompts[0]


@pytest.mark.parametrize("relation", ["historical_matches_current", "historical_differs_current"])
def test_diagnosis_sees_complete_current_parser_with_bound_format_facts(
    monkeypatch: pytest.MonkeyPatch, relation: str
) -> None:
    source = "# bounded actual parser\n" * 150 + "def main(text):\n    return {'result': text.lstrip('\\ufeff')}\n"
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {"type": "code", "code": source, "variables": [], "outputs": {"result": {"type": "string"}}},
            }
        ],
        "edges": [],
    }
    historical = deepcopy(graph)
    if relation == "historical_differs_current":
        historical["nodes"][0]["data"]["code"] = "def main(text): return {'result': text}"
    outputs = [NodeOutput(node_id="culprit", status="failed", inputs={"text": "| a | b |\n| --- | --- |\n| 1 | 2 |"})]
    evidence = build_evidence(Run(status="failed"), graph, historical, outputs)[3]
    prompt = _diagnosis_prompt(monkeypatch, graph, outputs, evidence)
    assert json.dumps(source, ensure_ascii=False) in prompt
    assert "CURRENT CULPRIT SOURCE CONTEXT" in prompt
    assert relation in prompt
    assert '"format":"markdown-table"' in prompt


@pytest.mark.parametrize(
    "unbound", ["no-history", "ambiguous-row", "wrong-row", "duplicate-current", "not-code", "changed-binding"]
)
def test_diagnosis_does_not_expand_unbound_or_mismatched_source(monkeypatch: pytest.MonkeyPatch, unbound: str) -> None:
    source = "SOURCE_MUST_NOT_EXPAND\n" * 100
    graph: Graph = {
        "nodes": [{"id": "culprit", "data": {"type": "code", "code": source, "variables": []}}],
        "edges": [],
    }
    outputs = [NodeOutput(node_id="culprit", status="failed", inputs={"text": "a,b\n1,2"})]
    historical = deepcopy(graph)
    if unbound == "no-history":
        historical = None
    elif unbound == "changed-binding":
        graph["nodes"][0]["data"]["variables"] = [{"variable": "new", "value_selector": ["start", "new"]}]
    evidence = build_evidence(Run(status="failed"), graph, historical, outputs)[3]
    if unbound == "ambiguous-row":
        outputs.append(deepcopy(outputs[0]))
    elif unbound == "wrong-row":
        outputs[0].node_id = "other"
    elif unbound == "duplicate-current":
        graph["nodes"].append(deepcopy(graph["nodes"][0]))
    elif unbound == "not-code":
        graph["nodes"][0]["data"]["type"] = "tool"
    prompt = _diagnosis_prompt(monkeypatch, graph, outputs, evidence)
    assert "SOURCE_MUST_NOT_EXPAND" not in prompt
    assert "CURRENT CULPRIT SOURCE CONTEXT" not in prompt


def test_diagnosis_expanded_source_redacts_credentials_and_excludes_neighbors(monkeypatch: pytest.MonkeyPatch) -> None:
    source = "# parser\n" * 200 + "secret = 'private-token'\n"
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "code": source,
                    "authorization": {"type": "api-key", "config": {"api_key": "private-token"}},
                },
            },
            {"id": "neighbor", "data": {"type": "code", "code": "NEIGHBOR_PRIVATE_SOURCE"}},
        ],
        "edges": [],
    }
    outputs = [NodeOutput(node_id="culprit", status="failed", inputs={"text": "a,b\n1,2"})]
    evidence = build_evidence(Run(status="failed"), graph, graph, outputs)[3]
    prompt = _diagnosis_prompt(monkeypatch, graph, outputs, evidence)
    assert "CURRENT CULPRIT SOURCE CONTEXT" in prompt
    assert "__DIFY_BUILDER_REDACTED__" in prompt
    assert "private-token" not in prompt
    assert "NEIGHBOR_PRIVATE_SOURCE" not in prompt


def test_diagnosis_oversized_source_is_explicitly_omitted_without_a_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "culprit",
                "data": {
                    "type": "code",
                    "code": "SOURCE_MUST_BE_WHOLE" + "中" * 30_000,
                    "outputs": {"result": {"type": "string"}},
                },
            }
        ],
        "edges": [],
    }
    outputs = [NodeOutput(node_id="culprit", status="failed", inputs={"text": "a,b\n1,2"})]
    evidence = build_evidence(Run(status="failed"), graph, graph, outputs)[3]
    prompt = _diagnosis_prompt(monkeypatch, graph, outputs, evidence)
    assert "SOURCE_MUST_BE_WHOLE" not in prompt
    assert '"characters": 30020' in prompt
    assert '"outputs": {"result": {"type": "string"}}' in prompt
    assert "Do not reconstruct or replace omitted fields" in prompt
    assert len(prompt.encode()) < 40_000


@pytest.mark.parametrize(
    "boundary", ["bound", "source-omitted", "unbound", "non-code", "changed-binding", "code-drift"]
)
def test_code_diagnosis_and_proposal_share_failure_policy_at_source_boundary(
    monkeypatch: pytest.MonkeyPatch, boundary: str
) -> None:
    """A diagnosis must not prescribe identity grouping that the repair policy forbids."""
    from core.workflow.generator.prompts.builder_prompts import CODE_FAILURE_POLICY_RULES

    source = (
        "def classify(record, input_index):\n"
        "    identity = record.get('record_key')\n"
        "    if not isinstance(identity, str) or not identity.strip():\n"
        "        return {'status': 'invalid', 'record': record, 'input_index': input_index}\n"
        "    return {'status': 'valid', 'record': record}\n"
    )
    if boundary == "source-omitted":
        source = "# SOURCE_REQUIRES_MANUAL_REVIEW\n" * 2000 + source
    graph: Graph = {
        "nodes": [{"id": "culprit", "data": {"type": "code", "code": source, "variables": []}}],
        "edges": [],
    }
    historical = deepcopy(graph)
    if boundary == "non-code":
        graph["nodes"][0]["data"]["type"] = "tool"
        historical = deepcopy(graph)
    elif boundary == "changed-binding":
        graph["nodes"][0]["data"]["variables"] = [{"variable": "different", "value_selector": ["start", "new"]}]
    elif boundary == "code-drift":
        historical["nodes"][0]["data"]["code"] = "def classify(record, input_index): return record"
    outputs = [NodeOutput(node_id="culprit", status="failed", inputs={"text": '[{"record_key":[]}]'})]
    run = Run(status="failed")
    evidence = build_evidence(run, graph, None if boundary == "unbound" else historical, outputs)[3]
    prompts: list[dict[str, str]] = []

    def answer(_model: object, *, system: str, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append({"system": system, "user": user})
        if len(prompts) == 1:
            return {"culprit_node_id": "culprit", "root_cause": "Review invalid-record contract", "severity": "high"}
        return {"intents": []}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)
    model = make_model_instance(provider="openai", model="test-model")
    diagnosis = fix.diagnose(model, run, graph, outputs, evidence=evidence)
    diagnosis.condition_evidence = evidence
    fix.propose_repair(model, diagnosis, graph)

    assert len(prompts) == 2
    assert CODE_FAILURE_POLICY_RULES in prompts[1]["system"]
    bound_code = boundary in {"bound", "source-omitted", "code-drift"}
    assert (CODE_FAILURE_POLICY_RULES in prompts[0]["system"]) is bound_code
    assert ("CURRENT CULPRIT SOURCE CONTEXT" in prompts[0]["user"]) is bound_code
    if boundary in {"bound", "code-drift"}:
        assert json.dumps(source, ensure_ascii=False) in prompts[0]["user"]
    elif boundary == "source-omitted":
        assert "SOURCE_REQUIRES_MANUAL_REVIEW" not in prompts[0]["user"]
        assert "Omitted source requires manual review" in prompts[0]["user"]

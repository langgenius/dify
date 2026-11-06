"""Repair prompts must contain complete bounded source, never imagined tails."""

import json
from copy import deepcopy
from unittest.mock import MagicMock

import pytest

from core.dify_builder.models import Diagnosis, Graph
from services.dify_builder.agent import fix


def _repair_prompt(monkeypatch: pytest.MonkeyPatch, graph: Graph) -> str:
    prompts: list[str] = []

    def answer(_model: object, *, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append(user)
        return {"intents": [], "risk": {"level": "low", "reason": "Needs review"}}

    monkeypatch.setattr(fix.llm, "invoke_json", answer)
    fix.propose_repair(MagicMock(), Diagnosis(culprit_node_id="culprit", root_cause="bad parser"), graph)
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

    intents, _risk = fix.propose_repair(MagicMock(), Diagnosis(culprit_node_id="culprit"), graph)

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

    intents, risk = fix.propose_repair(MagicMock(), Diagnosis(culprit_node_id="culprit"), graph)

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

    intents, _risk = fix.propose_repair(MagicMock(), Diagnosis(culprit_node_id="culprit"), graph)

    assert [(intent.args["path"], intent.args["value"]) for intent in intents] == [("title", "Updated parser")]

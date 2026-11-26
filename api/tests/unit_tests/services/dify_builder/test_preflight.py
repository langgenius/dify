"""``preflight_errors``: the dry ``Graph.init`` a draft is put through before
it is written or run. Exercised on the REAL ESQ1-303 dev draft (app 0f11bedc,
dumped from dev on 2026-09-21), which the engine refused to start.

Plus the two layers built on it: ``new_preflight_problems`` (the new-problems-only
rule ``apply_repair`` refuses a write on) and ``vet_intents`` (the whole engine
check a proposed batch passes before it can reach an approval gate)."""

import copy
import json
from pathlib import Path
from uuid import UUID

import pytest

from core.dify_builder.models import Graph, MutationIntent
from core.workflow.human_input_adapter import parse_human_input_delivery_methods
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from services.dify_builder import graph_ops
from services.dify_builder.preflight import new_preflight_problems, preflight_errors, validate_node_config, vet_intents
from services.workflow_generation.graph_normalizers import heal_nodes_for_preflight

_FIXTURES = Path(__file__).parent / "fixtures"


def _esq1_303_draft() -> Graph:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))


def test_the_esq1_303_dev_draft_would_not_start_and_the_error_names_the_node() -> None:
    errors = preflight_errors(_esq1_303_draft())

    assert len(errors) == 1
    assert errors[0].startswith("node 'node2' (if-else): ")
    assert "Input should be a valid string" in errors[0]  # value 60 is a JSON number


def test_every_broken_node_is_reported_not_only_the_first() -> None:
    graph = _esq1_303_draft()
    broken_twice = copy.deepcopy(next(n for n in graph["nodes"] if n["id"] == "node2"))
    broken_twice["id"] = "node2b"
    graph["nodes"].append(broken_twice)

    errors = preflight_errors(graph)

    assert [e.split(" ")[1] for e in errors] == ["'node2'", "'node2b'"]


def _human_input_graph(delivery_methods: object) -> Graph:
    return {
        "nodes": [
            {
                "id": "start",
                "type": "custom",
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {
                "id": "review",
                "type": "custom",
                "data": {
                    "type": "human-input",
                    "title": "Review",
                    "delivery_methods": delivery_methods,
                    "form_content": "Review and approve. {{#$output.comment#}}",
                    "inputs": [
                        {
                            "type": "paragraph",
                            "output_variable_name": "comment",
                            "default": {"type": "constant", "selector": [], "value": ""},
                        }
                    ],
                    "user_actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
                    "timeout": 3,
                    "timeout_unit": "day",
                },
            },
            {"id": "end", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"id": "start-review", "source": "start", "target": "review", "sourceHandle": "source"},
            {"id": "approved", "source": "review", "target": "end", "sourceHandle": "approve"},
            {"id": "timed-out", "source": "review", "target": "end", "sourceHandle": "__timeout"},
        ],
    }


def test_preflight_rejects_a_channel_kind_used_as_the_human_input_delivery_uuid() -> None:
    graph = _human_input_graph([{"id": "webapp", "type": "webapp", "enabled": True}])

    errors = preflight_errors(graph)

    assert len(errors) == 1
    assert errors[0].startswith("node 'review' (human-input): ")
    assert "0.webapp.id" in errors[0]
    assert "UUID" in errors[0]


@pytest.mark.parametrize("delivery_id", [None, "b3d2e84f-5629-4f43-9662-ac69ed1b551c"])
def test_preflight_accepts_native_human_input_delivery_ids_without_changing_the_graph(delivery_id: str | None) -> None:
    method = {"type": "webapp", "enabled": True}
    if delivery_id is not None:
        method["id"] = delivery_id
    graph = _human_input_graph([method])
    before = copy.deepcopy(graph)

    assert preflight_errors(graph) == []
    node_data = validate_node_config(graph["nodes"][1])
    methods = parse_human_input_delivery_methods(node_data)

    assert len(methods) == 1
    assert isinstance(methods[0].id, UUID)
    if delivery_id is None:
        assert methods[0].id.version == 4
        assert "id" not in node_data.model_dump()["delivery_methods"][0]
    else:
        assert methods[0].id == UUID("b3d2e84f-5629-4f43-9662-ac69ed1b551c")
        assert node_data.model_dump()["delivery_methods"][0]["id"] == delivery_id
    form_data = HumanInputNodeData.model_validate(node_data.model_dump())
    assert form_data.user_actions[0].id == "approve"
    assert form_data.inputs[0].output_variable_name == "comment"
    assert graph["nodes"][0]["data"]["variables"] == []
    assert [edge["sourceHandle"] for edge in graph["edges"][1:]] == ["approve", "__timeout"]
    assert graph == before


def _http_node(node_id: str, authorization: Graph) -> Graph:
    return {
        "id": node_id,
        "type": "custom",
        "data": {
            "type": "http-request",
            "title": "Call",
            "method": "post",
            "url": "https://x.test/a",
            "authorization": authorization,
            "headers": "",
            "params": "",
            "body": {"type": "none", "data": []},
        },
    }


def test_an_authorization_without_type_is_reported_not_raised() -> None:
    """The live E2E crash: graphon's ``HttpRequestNodeAuthorization.check_config``
    reads ``values.data["type"]``, which is absent once the required ``type``
    failed, so it raises KeyError -- which pydantic does not wrap and
    ``validate_node_config`` does not catch. A validation step must report
    it, never crash the Builder session. Built WITHOUT the normalizer."""
    graph: Graph = {"nodes": [_http_node("h", {"config": {"type": "bearer", "api_key": "x"}})], "edges": []}

    errors = preflight_errors(graph)

    assert errors == ["node 'h' (http-request): KeyError: 'type'"]


# Exactly which ``authorization`` shapes reach ``_CRASH_LOCATION``. The rule is
# not "no ``type``" -- graphon's ``check_config`` is a ``mode="before"`` validator
# on ``config``, so it only runs when a ``config`` KEY is present, and it then
# reads ``values.data["type"]``, which is absent whenever ``type`` failed its own
# Literal check. That comment has been written wrong twice; this pins it.
def test_a_crashing_node_does_not_hide_the_problems_of_the_nodes_after_it() -> None:
    graph = _esq1_303_draft()
    graph["nodes"].insert(0, _http_node("h", {"type": "bearer", "config": {"type": "bearer", "api_key": "x"}}))

    errors = preflight_errors(graph)

    assert [e.split(" ")[1] for e in errors] == ["'h'", "'node2'"]
    assert errors[0].startswith("node 'h' (http-request): KeyError: ")
    assert errors[1].startswith("node 'node2' (if-else): ")  # ValueError messages unchanged


# ---- new_preflight_problems --------------------------------------------------


def _scoring_graph(operator: str = "≥", value: object = "60") -> Graph:
    """A start + if-else draft the engine accepts as written."""
    return {
        "nodes": [
            {
                "id": "start",
                "type": "custom",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [
                        {"variable": "score", "type": "number", "label": "Score", "required": True, "options": []}
                    ],
                },
            },
            {
                "id": "branch",
                "type": "custom",
                "data": {
                    "type": "if-else",
                    "title": "Branch",
                    "cases": [
                        {
                            "case_id": "true",
                            "logical_operator": "and",
                            "conditions": [
                                {
                                    "id": "c1",
                                    "varType": "number",
                                    "variable_selector": ["start", "score"],
                                    "comparison_operator": operator,
                                    "value": value,
                                }
                            ],
                        }
                    ],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "branch", "sourceHandle": "source", "targetHandle": "target"}
        ],
    }


def test_a_newly_broken_node_is_reported_even_while_another_stays_broken() -> None:
    """A pre-existing refusal on one node does not buy silence for the rest of
    the draft: the if-else was already refused, the start node was not."""
    before = _scoring_graph(operator="==")
    after = copy.deepcopy(before)
    after["nodes"][0]["data"]["variables"][0]["type"] = "not-a-type"

    problems = new_preflight_problems(before, after, ())

    assert [p.split(" ")[1] for p in problems] == ["'start'"]


def _code_node(**data: object) -> Graph:
    return {
        "nodes": [{"id": "code1", "type": "custom", "data": {"type": "code", "title": "Code", **data}}],
        "edges": [],
    }


def test_a_node_the_batch_wrote_gets_no_exemption_at_all() -> None:
    """``touched`` is what closes the silent false success.

    The same bad field replaced by a DIFFERENT bad value is not a new problem to
    the location key, and no key short of "is it startable now?" could see it --
    pydantic's ``input`` for a ``Field required`` error is the parent dict, so
    keying on the input repr would refuse honest partial repairs instead. A
    repair targets a node that is by definition already invalid, so this is Fix's
    main line: untouched, the batch applies and the card says "Applied the
    changes" over a draft that still cannot start."""
    before = _code_node(code_language="klingon")
    after = _code_node(code_language="martian")

    assert new_preflight_problems(before, after, ()) == []  # nothing NEW -- and that was the bug
    problems = new_preflight_problems(before, after, ["code1"])

    assert len(problems) == 1
    assert problems[0].startswith("node 'code1' (code): ")
    assert "code_language" in problems[0]


def test_a_half_repaired_node_the_batch_wrote_is_refused_even_though_it_improved() -> None:
    """The companion to ``test_half_repairing_an_already_broken_node_is_not_a_new_problem``:
    the exemption that test pins is for a node NOBODY wrote. Fill one of the
    missing fields of a node this batch is answerable for and it is still not
    startable, so the batch is still refused -- with the node's whole remaining
    refusal, which is what the corrective re-prompt needs."""
    before = _code_node()
    after = _code_node(code="def main():\n    return {}")

    assert new_preflight_problems(before, after, ()) == []  # untouched: a strict improvement
    problems = new_preflight_problems(before, after, ["code1"])

    assert len(problems) == 1
    assert "code_language" in problems[0]  # what is STILL missing


def test_an_untouched_node_keeps_its_exemption_while_a_written_one_does_not() -> None:
    """Both rules in one graph, so neither can quietly become the other."""
    before: Graph = {"nodes": [*_code_node()["nodes"], *_code_node()["nodes"]], "edges": []}
    before["nodes"][1] = {**before["nodes"][1], "id": "code2"}
    after = copy.deepcopy(before)

    problems = new_preflight_problems(before, after, ["code2"])

    assert [p.split(" ")[1] for p in problems] == ["'code2'"]


def test_an_already_invalid_node_broken_further_is_a_new_problem() -> None:
    """Why the rule is not keyed on NODE IDENTITY either. ``code1`` is refused
    before AND after, and the count of messages does not move -- but the change
    added a refusal at a field path that was fine, and that is a new problem.

    This is Fix's main path, not an edge case: for the whole
    ESQ1-302 / ESQ1-303 / F4 family the node ``propose_repair`` targets is by
    definition already preflight-invalid, so keying on the node would leave the
    repair with no node-data coverage on its own culprit."""
    before = _code_node(code_language="python3")  # already invalid, but this field is fine
    after = _code_node(code_language="klingon")  # ...and now it is not

    assert len(preflight_errors(before)) == len(preflight_errors(after)) == 1
    problems = new_preflight_problems(before, after, ())

    assert len(problems) == 1
    assert problems[0].startswith("node 'code1' (code): ")
    assert "code_language" in problems[0]
    # ...and the same change in reverse is a repair, not a problem
    assert new_preflight_problems(after, before, ()) == []


def test_a_recreated_id_of_a_different_type_is_a_new_node() -> None:
    before: Graph = {"nodes": [{"id": "n1", "type": "custom", "data": {"type": "code", "title": "Code"}}], "edges": []}
    after: Graph = {"nodes": [{"id": "n1", "type": "custom", "data": {"type": "llm", "title": "LLM"}}], "edges": []}

    problems = new_preflight_problems(before, after, ())

    assert len(problems) == 1
    assert problems[0].startswith("node 'n1' (llm): ")


# ---- vet_intents -------------------------------------------------------------

_ALLOWED = {"if-else", "start", "llm", "end", "template-transform"}


def _operator_of(graph: Graph) -> str:
    """The one condition operator ``_scoring_graph`` carries."""
    branch = next(n for n in graph["nodes"] if n["id"] == "branch")
    return branch["data"]["cases"][0]["conditions"][0]["comparison_operator"]


def _set_operator(value: str) -> MutationIntent:
    return MutationIntent(
        op="set_node_config",
        args={"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": value},
    )


# ---- the rejection text must not carry the node's credentials ----


_SECRET_KEY = "sk-live-9f3c-SECRET"
_SECRET_HEADER = "tok-999-SECRET"


_AUTHORIZATION = {"type": "api-key", "config": {"type": "bearer", "header": "X-Auth", "api_key": _SECRET_KEY}}
_HEADERS = f"Authorization: Bearer {_SECRET_HEADER}"


def _secret_http_node(data: Graph) -> Graph:
    return {"id": "h", "type": "custom", "data": {"type": "http-request", **data}}


@pytest.mark.parametrize(
    ("data", "leaked"),
    [
        # pydantic truncates the MIDDLE of its input repr and keeps both ends, so
        # which secret survives depends on key order. Both are genuinely
        # reachable, so both are pinned.
        ({"authorization": _AUTHORIZATION, "headers": _HEADERS}, _SECRET_HEADER),
        ({"headers": _HEADERS, "authorization": _AUTHORIZATION}, _SECRET_KEY),
    ],
)
def test_the_refusal_text_withholds_the_nodes_credentials(data: Graph, leaked: str) -> None:
    """pydantic puts ``input_value=<repr of what it was given>`` in its message,
    and for a model-level error (a required field missing) that repr is the
    node's WHOLE ``data`` -- which for an http-request node is where a live
    bearer token sits. This message goes straight into a corrective re-prompt.

    The raw engine text really does carry a secret in both shapes below, so the
    redaction is load-bearing rather than belt-and-braces."""
    node = _secret_http_node(data)
    with pytest.raises(ValueError, match=r"node 'h' \(http-request\)") as raw:
        validate_node_config(node)
    assert leaked in str(raw.value)  # the engine's own text leaks it...

    errors = preflight_errors({"nodes": [node], "edges": []})

    assert len(errors) == 1
    assert _SECRET_KEY not in errors[0]  # ...and this one leaks neither
    assert _SECRET_HEADER not in errors[0]
    assert errors[0].startswith("node 'h' (http-request): ")  # still says which node, and why
    assert "url" in errors[0]


_BODY_SECRET = "BODYSECRET"


def test_a_secret_in_a_request_body_is_outside_redactions_declared_scope() -> None:
    """Pins the boundary, in the honest direction.

    ``credentials.redact_node_config`` covers ``authorization`` / ``headers`` /
    ``params`` -- fields that exist to hold a secret. A ``body`` value does not,
    and it reaches the refusal text verbatim; anything that stores or re-prompts
    this text (``handlers_edit.last_edit_rejection``) inherits that. Asserting it
    rather than letting a docstring claim otherwise -- and see
    ``services.dify_builder.credentials`` for why widening the profile would
    make http-request bodies uneditable instead of safer."""
    node = _secret_http_node(
        {
            "method": "post",  # no ``url`` -> a MODEL-level error, so pydantic dumps the whole data
            "authorization": _AUTHORIZATION,
            "headers": _HEADERS,
            "body": {"type": "json", "data": [{"key": "", "type": "text", "value": f'{{"token":"{_BODY_SECRET}"}}'}]},
        }
    )

    errors = preflight_errors({"nodes": [node], "edges": []})

    assert len(errors) == 1
    assert _SECRET_KEY not in errors[0]  # in scope: withheld
    assert _SECRET_HEADER not in errors[0]  # in scope: withheld
    assert _BODY_SECRET in errors[0]  # OUT of scope: carried, and documented as such


def test_an_operator_no_normalizer_can_heal_is_rejected_by_the_node_data_check() -> None:
    """The keystone: ``==`` applies cleanly (the structural filter says
    "applicable, 0 rejected") and then kills the write at ``apply_repair``'s
    preflight. That is the live F4 shape -- four applicable intents, a batch that
    died at the port, and a corrective re-prompt that could never fire because
    nothing had been rejected.

    ``==`` is chosen because NO normalizer heals it and none ever will: graphon
    spells string equality ``is`` / ``is not`` and number equality ``=`` / ``≠``,
    so ``==`` is ambiguous between them and guessing would silently change which
    comparison the draft runs (``graph_normalizers._ASCII_COMPARISON_OPERATORS``
    carries the two unambiguous ORDERING forms and nothing else). Step (b) proves
    it rather than assuming it.
    """
    graph = _scoring_graph()
    intents = [_set_operator("==")]

    # (a) the structural filter alone is blind to it
    dry_run = graph_ops.filter_applicable(graph, intents, _ALLOWED)
    assert dry_run.rejected == []
    assert dry_run.applicable == intents

    # (b) run the heal set over an UNHEALED application of the same intent -- the
    # dry run above already healed its own graph, so asserting on that one would
    # only prove the heal set is idempotent. This is the line that fails the day
    # "==" becomes healable: it reports nothing changed, the operator is still
    # there, and the engine still refuses the result.
    unhealed, _changed = graph_ops.apply_set_node_config(graph, **intents[0].args)
    assert heal_nodes_for_preflight(unhealed["nodes"]) == []
    assert _operator_of(unhealed) == "=="
    assert preflight_errors(unhealed)

    # (c) ...so vet_intents rejects it, in the engine's own words
    vetted = vet_intents(graph, intents, _ALLOWED)
    assert len(vetted.rejections) == 1
    assert vetted.rejections[0].startswith("- the draft would then not start: node 'branch' (if-else): ")
    assert "comparison_operator" in vetted.rejections[0]


def test_a_draft_the_user_already_broke_does_not_veto_an_unrelated_edit() -> None:
    """New problems only. The if-else was refused before the edit and is refused
    after it; the edit renamed a different node and must go through."""
    broken = _scoring_graph(operator="==")
    rename = MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Begin"})

    vetted = vet_intents(broken, [rename], _ALLOWED)

    assert vetted.rejections == []
    assert vetted.applicable == [rename]


def test_a_batch_that_leaves_its_own_culprit_invalid_is_refused_before_the_gate() -> None:
    """The dry run has to predict the port's refusal, or the corrective
    re-prompt cannot fire and the handler learns nothing to carry forward.

    ``branch`` is already refused at the operator; the batch rewrites that exact
    field to another value the engine also refuses. Nothing is NEW, so before the
    ``touched`` rule this reached the approval gate looking healthy and died at
    the write."""
    already_broken = _scoring_graph(operator="==")

    vetted = vet_intents(already_broken, [_set_operator("klingon")], _ALLOWED)

    assert len(vetted.rejections) == 1
    assert "node 'branch' (if-else)" in vetted.rejections[0]
    assert "comparison_operator" in vetted.rejections[0]


def test_wiring_an_already_broken_node_does_not_make_the_batch_answerable_for_it() -> None:
    """``touched`` is "wrote this node's DATA", not "appears in the change set".

    ``apply_connect`` reports BOTH endpoints as changed -- right for a diff,
    wrong here: an edge cannot change either endpoint's
    ``validate_node_config`` verdict. Counting them would mean that merely
    wiring a node the user already broke makes its pre-existing defect veto the
    whole batch, which is the invariant the untouched rule exists to keep."""
    already_broken: Graph = {
        "nodes": [
            {"id": "llm1", "type": "custom", "data": {"type": "llm", "title": "LLM"}},
            {"id": "end1", "type": "custom", "data": {"type": "end", "title": "End"}},
        ],
        "edges": [],
    }
    assert len(preflight_errors(already_broken)) == 2  # both endpoints are refused as they stand

    wire = MutationIntent(op="connect", args={"from_node": "llm1", "to_node": "end1"})
    vetted = vet_intents(already_broken, [wire], {"llm", "end"})

    assert vetted.rejections == []
    assert vetted.applicable == [wire]


def test_a_created_node_the_engine_would_refuse_is_named_in_the_rejection() -> None:
    """The node the batch ADDS has no "before" to compare against, so anything
    the engine refuses about it is new by definition -- and the rejection names
    the id the LLM chose, which is what makes it actionable in the re-prompt."""
    intent = MutationIntent(op="create_node", args={"node_type": "if-else", "node_id": "n9", "config": {"cases": 7}})

    vetted = vet_intents(_scoring_graph(), [intent], _ALLOWED)

    assert len(vetted.rejections) == 1
    assert "node 'n9' (if-else)" in vetted.rejections[0]


def test_a_structural_rejection_line_withholds_the_nodes_credentials() -> None:
    """A rejection line inlines the whole ``intent.args`` -- including a
    ``create_node``'s entire ``config`` -- into a corrective re-prompt, which is
    the same channel ``_withheld_message`` already guards for a node's stored
    config. These args are model-authored today, so nothing stored leaks; the
    redaction is here so a later path that round-trips a real node's data
    through an intent cannot silently re-open the hole."""
    intent = MutationIntent(
        op="create_node",
        args={
            "node_type": "http-request",  # not in _ALLOWED -- a structural refusal
            "node_id": "h",
            "config": {"title": "t", "method": "get", "url": "u", "authorization": _AUTHORIZATION, "headers": _HEADERS},
        },
    )

    vetted = vet_intents(_scoring_graph(), [intent], _ALLOWED)

    assert len(vetted.rejections) == 1
    assert _SECRET_KEY not in vetted.rejections[0]
    assert _SECRET_HEADER not in vetted.rejections[0]
    assert "__DIFY_BUILDER_REDACTED__" in vetted.rejections[0]  # the KEYS still reach the model
    assert "node_type not allowed" in vetted.rejections[0]  # ...and so does the engine's reason


def test_a_crash_message_never_reaches_the_text_the_model_is_shown() -> None:
    """The crash message is the one part of a location not derived from a field
    path, so it is the one part that could echo a value out of the node. It is
    keyed on, never rendered."""
    from services.dify_builder.preflight import _CRASH_LOCATION, _location_label

    assert _location_label((_CRASH_LOCATION, "KeyError", "'sk-live-SECRET'")) == "<crash>.KeyError"
    assert _location_label(("cases", "0", "comparison_operator")) == "cases.0.comparison_operator"


# ---- a new branch must feed the variable-aggregator it rejoins ---------------

_REJOIN_ALLOWED = {"start", "if-else", "template-transform", "variable-aggregator", "end"}

_EXISTING_SELECTORS = [["node3", "output"], ["node4", "output"]]


def _rejoin_graph(aggregator_data: Graph | None = None) -> Graph:
    """The live S6 draft's shape: start -> if-else -> two template-transforms ->
    variable-aggregator -> end, every node as the engine accepts it."""
    return {
        "nodes": [
            {
                "id": "node1",
                "type": "custom",
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [
                        {"variable": "score", "type": "number", "label": "Score", "required": True, "options": []}
                    ],
                },
            },
            {
                "id": "node2",
                "type": "custom",
                "data": {
                    "type": "if-else",
                    "title": "Check Threshold",
                    "cases": [
                        {
                            "case_id": "true",
                            "logical_operator": "and",
                            "conditions": [
                                {
                                    "id": "c1",
                                    "varType": "number",
                                    "variable_selector": ["node1", "score"],
                                    "comparison_operator": "=",
                                    "value": "60",
                                }
                            ],
                        }
                    ],
                },
            },
            {
                "id": "node3",
                "type": "custom",
                "data": {"type": "template-transform", "title": "Pass", "template": "pass", "variables": []},
            },
            {
                "id": "node4",
                "type": "custom",
                "data": {"type": "template-transform", "title": "Fail", "template": "fail", "variables": []},
            },
            {
                "id": "node5",
                "type": "custom",
                "data": aggregator_data
                or {
                    "type": "variable-aggregator",
                    "title": "Merge Result",
                    "output_type": "string",
                    "variables": copy.deepcopy(_EXISTING_SELECTORS),
                },
            },
            {
                "id": "node6",
                "type": "custom",
                "data": {"type": "end", "title": "End", "outputs": [{"variable": "result", "value_selector": []}]},
            },
        ],
        "edges": [
            {"id": "e1", "source": "node1", "target": "node2", "sourceHandle": "source", "targetHandle": "target"},
            {"id": "e2", "source": "node2", "target": "node3", "sourceHandle": "true", "targetHandle": "target"},
            {"id": "e3", "source": "node2", "target": "node4", "sourceHandle": "false", "targetHandle": "target"},
            {"id": "e4", "source": "node3", "target": "node5", "sourceHandle": "source", "targetHandle": "target"},
            {"id": "e5", "source": "node4", "target": "node5", "sourceHandle": "source", "targetHandle": "target"},
            {"id": "e6", "source": "node5", "target": "node6", "sourceHandle": "source", "targetHandle": "target"},
        ],
    }


def _new_branch_intents(target: str = "node5") -> list[MutationIntent]:
    """The structural half of the live S6 batch: a new arm off the if-else that
    rejoins at ``target``."""
    return [
        MutationIntent(
            op="create_node",
            args={
                "node_type": "template-transform",
                "node_id": "node7",
                "config": {"title": "Excellent Message", "template": "excellent", "variables": []},
            },
        ),
        MutationIntent(op="connect", args={"from_node": "node2", "to_node": "node7", "source_handle": "true"}),
        MutationIntent(op="connect", args={"from_node": "node7", "to_node": target}),
    ]


def test_a_new_branch_into_an_aggregator_that_does_not_list_it_is_refused() -> None:
    """The one shape that still produced "All checks passed" on empty output:
    the aggregator stays engine-VALID (its two existing selectors resolve), so
    the preflight has nothing to say, and graphon's ``VariableAggregatorNode``
    skips the arm it was never told about in silence."""
    vetted = vet_intents(_rejoin_graph(), _new_branch_intents(), _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    reason = vetted.rejections[0]
    assert "node5" in reason
    assert "node7" in reason
    assert '["node7", "output"]' in reason


def test_the_same_branch_is_accepted_once_the_aggregator_lists_it() -> None:
    """The other half: the batch that does the whole job goes through
    untouched, so the guard cannot be satisfied by refusing everything."""
    intents = [
        *_new_branch_intents(),
        MutationIntent(
            op="set_node_config",
            args={
                "node_id": "node5",
                "path": "variables",
                "value": [*copy.deepcopy(_EXISTING_SELECTORS), ["node7", "output"]],
            },
        ),
    ]

    vetted = vet_intents(_rejoin_graph(), intents, _REJOIN_ALLOWED)

    assert vetted.rejections == []
    assert len(vetted.applicable) == 4


def test_a_two_node_branch_is_accepted_when_the_aggregator_lists_its_head() -> None:
    """A branch of more than one node is an ordinary shape. The batch adds
    ``node7 -> node8`` and ``node8 -> node5``; both run whenever the new arm
    runs, so an aggregator that lists EITHER of them has been told about it.
    Keyed on the edge's immediate source alone, this was refused."""
    graph = _rejoin_graph(
        aggregator_data={
            "type": "variable-aggregator",
            "title": "Merge Result",
            "output_type": "string",
            "variables": [*copy.deepcopy(_EXISTING_SELECTORS), ["node7", "output"]],
        }
    )
    intents = [
        MutationIntent(
            op="create_node",
            args={
                "node_type": "template-transform",
                "node_id": "node7",
                "config": {"title": "Excellent", "template": "excellent", "variables": []},
            },
        ),
        MutationIntent(
            op="create_node",
            args={
                "node_type": "template-transform",
                "node_id": "node8",
                "config": {"title": "Decorate", "template": "{{ x }}", "variables": []},
            },
        ),
        MutationIntent(op="connect", args={"from_node": "node2", "to_node": "node7", "source_handle": "true"}),
        MutationIntent(op="connect", args={"from_node": "node7", "to_node": "node8"}),
        MutationIntent(op="connect", args={"from_node": "node8", "to_node": "node5"}),
    ]

    vetted = vet_intents(graph, intents, _REJOIN_ALLOWED)

    assert vetted.rejections == []


def test_the_ancestor_walk_does_not_cross_into_the_graphs_other_arms() -> None:
    """The soundness limit of that walk, and the reason it follows only the
    batch's OWN new edges. ``node5`` lists ``node3``/``node4``, which sit on the
    if-else's OTHER arms -- they never run when the new one does. A walk through
    pre-existing edges would find ``node2`` above them all and accept exactly
    the batch that produces nothing."""
    vetted = vet_intents(_rejoin_graph(), _new_branch_intents(), _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1


def test_a_selector_naming_a_variable_the_node_does_not_publish_is_refused() -> None:
    """Rooted-at is not enough. A template-transform publishes ``output``; a
    selector naming ``text`` on it is exactly as unresolvable as no selector at
    all and the run skips it in the same silence, so accepting any name would
    leave the failure intact behind a selector that looks right."""
    graph = _rejoin_graph(
        aggregator_data={
            "type": "variable-aggregator",
            "title": "Merge Result",
            "output_type": "string",
            "variables": [*copy.deepcopy(_EXISTING_SELECTORS), ["node7", "text"]],
        }
    )

    vetted = vet_intents(graph, _new_branch_intents(), _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    assert '["node7", "output"]' in vetted.rejections[0]  # ...and it says which name to use


def test_a_code_nodes_published_names_are_read_off_the_node_itself() -> None:
    """A code node declares its own outputs, so that is where the answer is --
    ``result`` is published and accepted, and nothing else would be."""
    graph = _rejoin_graph(
        aggregator_data={
            "type": "variable-aggregator",
            "title": "Merge Result",
            "output_type": "string",
            "variables": [*copy.deepcopy(_EXISTING_SELECTORS), ["node7", "result"]],
        }
    )
    intents = [
        MutationIntent(
            op="create_node",
            args={
                "node_type": "code",
                "node_id": "node7",
                "config": {
                    "title": "Grade",
                    "code": "def main():\n    return {'result': 'excellent'}",
                    "code_language": "python3",
                    "variables": [],
                    "outputs": {"result": {"type": "string"}},
                },
            },
        ),
        MutationIntent(op="connect", args={"from_node": "node2", "to_node": "node7", "source_handle": "true"}),
        MutationIntent(op="connect", args={"from_node": "node7", "to_node": "node5"}),
    ]

    vetted = vet_intents(graph, intents, {*_REJOIN_ALLOWED, "code"})

    assert [r for r in vetted.rejections if "variable-aggregator" in r] == []


def test_a_grouped_aggregator_that_lists_the_new_branch_in_a_group_is_accepted() -> None:
    """graphon reads the selectors out of ``advanced_settings.groups`` when
    ``group_enabled`` is set, so a guard that only looked at ``variables``
    would refuse a branch that is already wired correctly."""
    graph = _rejoin_graph(
        aggregator_data={
            "type": "variable-aggregator",
            "title": "Merge Result",
            "output_type": "string",
            "variables": copy.deepcopy(_EXISTING_SELECTORS),
            "advanced_settings": {
                "group_enabled": True,
                "groups": [
                    {
                        "group_name": "result",
                        "output_type": "string",
                        "variables": [*copy.deepcopy(_EXISTING_SELECTORS), ["node7", "output"]],
                    }
                ],
            },
        }
    )

    vetted = vet_intents(graph, _new_branch_intents(), _REJOIN_ALLOWED)

    assert vetted.rejections == []


# ---- a whole-array write must not drop an element that had an identity ------


_S6_CASES_REWRITE = [
    {
        "case_id": "excellent",
        "logical_operator": "and",
        "conditions": [{"variable_selector": ["node1", "score"], "comparison_operator": ">=", "value": 90}],
    },
    {
        "case_id": "true",
        "logical_operator": "and",
        "conditions": [{"variable_selector": ["node1", "score"], "comparison_operator": ">=", "value": 60}],
    },
]


def test_a_whole_array_rewrite_that_drops_an_elements_identity_is_refused() -> None:
    """The live S6 clobber. The rewrite keeps both ``case_id``s, so it looks
    like an append -- but it regenerated the surviving case's condition from
    scratch, losing its ``id`` and turning ``= 60`` into ``≥ 60``. graphon's
    ``Condition`` has no ``id`` field at all, so nothing downstream ever
    complains."""
    intent = MutationIntent(
        op="set_node_config",
        args={"node_id": "node2", "path": "cases", "value": copy.deepcopy(_S6_CASES_REWRITE)},
    )

    vetted = vet_intents(_rejoin_graph(), [intent], _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    reason = vetted.rejections[0]
    assert "node2" in reason
    assert "cases" in reason
    assert "c1" in reason


def test_an_append_that_repeats_every_existing_element_is_accepted() -> None:
    """What the op schema tells the model to do, byte for byte: the existing
    case comes back unchanged and the new one is appended."""
    graph = _rejoin_graph()
    existing = copy.deepcopy(next(n for n in graph["nodes"] if n["id"] == "node2")["data"]["cases"])
    appended = [
        *existing,
        {
            "case_id": "excellent",
            "logical_operator": "and",
            "conditions": [
                {
                    "id": "c2",
                    "varType": "number",
                    "variable_selector": ["node1", "score"],
                    "comparison_operator": "≥",
                    "value": "90",
                }
            ],
        },
    ]
    intent = MutationIntent(op="set_node_config", args={"node_id": "node2", "path": "cases", "value": appended})

    vetted = vet_intents(graph, [intent], _REJOIN_ALLOWED)

    assert vetted.rejections == []


def test_a_question_classifiers_classes_keep_their_branch_ids() -> None:
    """The other scoped array that is a branch handle. ``ClassConfig.id`` is
    required by graphon and is what an edge routes on, so a rewrite that drops
    one orphans that arm exactly the way a lost ``case_id`` would.

    The replacement class carries an id of its own, so the engine is perfectly
    happy with the result -- which is the point: only this guard notices that
    ``c-low``'s arm now hangs off nothing."""
    graph = _rejoin_graph()
    graph["nodes"].append(
        {
            "id": "qc1",
            "type": "custom",
            "data": {
                "type": "question-classifier",
                "title": "Sort",
                "query_variable_selector": ["node1", "score"],
                "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
                "classes": [{"id": "c-high", "name": "high"}, {"id": "c-low", "name": "low"}],
            },
        }
    )
    intent = MutationIntent(
        op="set_node_config",
        args={
            "node_id": "qc1",
            "path": "classes",
            "value": [{"id": "c-high", "name": "high"}, {"id": "c-new", "name": "middling"}],
        },
    )

    vetted = vet_intents(graph, [intent], {*_REJOIN_ALLOWED, "question-classifier"})

    assert len(vetted.rejections) == 1
    assert "c-low" in vetted.rejections[0]


def _two_case_graph(operator: str = "≥", value: object = "60") -> Graph:
    """The rejoin draft with a SECOND case on ``node2``, so there is something
    to delete."""
    graph = _rejoin_graph()
    node2 = next(n for n in graph["nodes"] if n["id"] == "node2")
    node2["data"]["cases"] = [
        {
            "case_id": "true",
            "logical_operator": "and",
            "conditions": [
                {
                    "id": "c1",
                    "varType": "number",
                    "variable_selector": ["node1", "score"],
                    "comparison_operator": operator,
                    "value": value,
                }
            ],
        },
        {
            "case_id": "excellent",
            "logical_operator": "and",
            "conditions": [
                {
                    "id": "c2",
                    "varType": "number",
                    "variable_selector": ["node1", "score"],
                    "comparison_operator": "≥",
                    "value": "90",
                }
            ],
        },
    ]
    return graph


def _cases_of(graph: Graph) -> list[Graph]:
    return next(n for n in graph["nodes"] if n["id"] == "node2")["data"]["cases"]


def test_deleting_one_case_while_modifying_another_is_refused() -> None:
    """The mixed write, and the reason a deletion is recognised by what it
    KEEPS rather than by what is missing: one element is gone and the survivor
    was rewritten in the same breath. That is the S6 clobber wearing a
    deletion's clothes."""
    graph = _two_case_graph()
    modified = copy.deepcopy(_cases_of(graph)[0])
    modified["conditions"][0]["comparison_operator"] = "≤"
    intent = MutationIntent(op="set_node_config", args={"node_id": "node2", "path": "cases", "value": [modified]})

    vetted = vet_intents(graph, [intent], _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    assert "c2" in vetted.rejections[0]  # the identity that went missing


def test_a_deletion_is_not_a_licence_to_repeat_one_element_in_place_of_two() -> None:
    """Each original may be claimed once. Re-sending the surviving case twice
    keeps the array's length honest while still losing the other case's
    identity, and would pass a naive subset test."""
    graph = _two_case_graph()
    survivor = copy.deepcopy(_cases_of(graph)[0])
    intent = MutationIntent(
        op="set_node_config",
        args={"node_id": "node2", "path": "cases", "value": [survivor, copy.deepcopy(survivor)]},
    )

    vetted = vet_intents(graph, [intent], _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    assert "c2" in vetted.rejections[0]


def test_a_deletion_survives_a_survivor_the_heal_set_will_normalize() -> None:
    """``after`` is the dry run's already-healed graph, so the comparison is
    made against a healed copy of ``before`` too. A draft holding ``">="`` and
    a JSON ``60`` -- the ESQ1-303 shape this whole plan grew out of -- would
    otherwise make a survivor the model re-sent verbatim look modified, and a
    genuine deletion would be refused for a difference the heal introduced."""
    graph = _two_case_graph(operator=">=", value=60)
    kept = [copy.deepcopy(_cases_of(graph)[0])]
    assert kept[0]["conditions"][0]["comparison_operator"] == ">="  # the draft really is unhealed
    intent = MutationIntent(op="set_node_config", args={"node_id": "node2", "path": "cases", "value": kept})

    vetted = vet_intents(graph, [intent], _REJOIN_ALLOWED)

    assert vetted.rejections == []


def test_adding_a_case_while_dropping_another_is_still_refused() -> None:
    """A write that both loses an identity and ADDS an element is not a
    deletion by any reading -- this is the S6 shape at its plainest."""
    graph = _two_case_graph()
    intent = MutationIntent(
        op="set_node_config",
        args={
            "node_id": "node2",
            "path": "cases",
            "value": [
                copy.deepcopy(_cases_of(graph)[0]),
                {
                    "case_id": "outstanding",
                    "logical_operator": "and",
                    "conditions": [
                        {"variable_selector": ["node1", "score"], "comparison_operator": "≥", "value": "95"}
                    ],
                },
            ],
        },
    )

    vetted = vet_intents(graph, [intent], _REJOIN_ALLOWED)

    assert len(vetted.rejections) == 1
    assert "c2" in vetted.rejections[0]


def test_a_rejection_line_withholds_a_credential_the_intents_own_path_names() -> None:
    """``_withheld_args`` redacts a ``value`` that is shaped like a whole node
    ``data``. A ``set_node_config`` does not send one: it sends the value at a
    PATH, so ``path="headers"`` with a header line, or ``path="authorization"``
    with the auth block itself, reached the retry prompt unredacted.

    Unreachable with a stored secret today -- these args are model-authored and
    the model is never shown one -- so this closes the shape, not a live leak.
    """
    from services.dify_builder.preflight import _withheld_args

    header_line = _withheld_args(
        MutationIntent(op="set_node_config", args={"node_id": "h", "path": "headers", "value": _HEADERS})
    )
    whole_block = _withheld_args(
        MutationIntent(op="set_node_config", args={"node_id": "h", "path": "authorization", "value": _AUTHORIZATION})
    )
    nested_config = _withheld_args(
        MutationIntent(
            op="set_node_config",
            args={"node_id": "h", "path": "authorization.config", "value": _AUTHORIZATION["config"]},
        )
    )

    assert _SECRET_HEADER not in header_line["value"]
    assert "Authorization" in header_line["value"]  # the header NAME still reaches the model
    assert _SECRET_KEY not in json.dumps(whole_block)
    assert whole_block["value"]["config"]["header"] == "X-Auth"  # ...and so does the structure
    assert _SECRET_KEY not in json.dumps(nested_config)
    assert nested_config["value"]["type"] == "bearer"  # the auth MODE is structure, not a secret


# These nodes pass native node-data validation: Builder's first-phase boundary
# must refuse their proposed addition independently of the native whitelist.
_FIRST_PHASE_CONFIGS = [
    ("knowledge-retrieval", {"dataset_ids": ["kb-1"]}),
    ("human-input", _human_input_graph([])["nodes"][1]["data"]),
    ("agent", {"agent_strategy_name": "legacy"}),
    ("agent", {"version": "2", "agent_node_kind": "dify_agent", "agent_task": "fabricated"}),
]


@pytest.mark.parametrize(("node_type", "config"), _FIRST_PHASE_CONFIGS)
@pytest.mark.parametrize("op", ["create_node", "insert_between"])
def test_candidate_refuses_first_phase_additions_without_losing_valid_batch_operations(
    node_type: str, config: dict[str, object], op: str
) -> None:
    from graphon.enums import BUILT_IN_NODE_TYPES

    graph: Graph = {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [{"id": "se", "source": "s", "target": "e"}],
    }
    args = {"node_type": node_type, "node_id": "new", "config": config}
    if op == "insert_between":
        args["edge"] = {"source": "s", "target": "e"}
    good = MutationIntent(op="set_node_config", args={"node_id": "s", "path": "title", "value": "Begin"})
    forbidden = MutationIntent(op=op, args=args)

    vetted = vet_intents(graph, [good, forbidden], set(BUILT_IN_NODE_TYPES))

    assert vetted.would_run_wrong, "native-valid unsupported additions must condemn the whole candidate batch"
    assert good in vetted.applicable
    assert forbidden in vetted.applicable
    assert any(node_type in reason for reason in vetted.rejections)


@pytest.mark.parametrize(("node_type", "config"), _FIRST_PHASE_CONFIGS)
def test_candidate_refuses_type_conversion_into_first_phase_nodes(node_type: str, config: dict[str, object]) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "n",
                "type": "custom",
                "data": {
                    "title": "Convert",
                    "code_language": "python3",
                    "code": "",
                    "variables": [],
                    "outputs": {},
                    "retrieval_mode": "multiple",
                    **config,
                    "type": "code",
                },
            }
        ],
        "edges": [],
    }
    intent = MutationIntent(op="set_node_config", args={"node_id": "n", "path": "type", "value": node_type})

    vetted = vet_intents(graph, [intent])

    assert vetted.would_run_wrong
    assert any(node_type in reason for reason in vetted.rejections)


@pytest.mark.parametrize(
    ("path", "value"), [("dataset_ids", ["kb-2"]), ("retrieval_mode", "single"), ("title", "New title")]
)
def test_candidate_refuses_retrieval_configuration_changes(path: str, value: object) -> None:
    graph: Graph = {
        "nodes": [
            {
                "id": "r",
                "type": "custom",
                "data": {
                    "type": "knowledge-retrieval",
                    "title": "Existing",
                    "dataset_ids": ["kb-1"],
                    "retrieval_mode": "multiple",
                },
            }
        ],
        "edges": [],
    }
    intent = MutationIntent(op="set_node_config", args={"node_id": "r", "path": path, "value": value})

    assert vet_intents(graph, [intent]).would_run_wrong


def test_candidate_refuses_legacy_agent_conversion_to_native_new_agent() -> None:
    graph: Graph = {"nodes": [{"id": "a", "type": "custom", "data": {"type": "agent", "title": "Legacy"}}], "edges": []}
    intents = [
        MutationIntent(op="set_node_config", args={"node_id": "a", "path": "version", "value": "2"}),
        MutationIntent(op="set_node_config", args={"node_id": "a", "path": "agent_node_kind", "value": "dify_agent"}),
    ]

    assert vet_intents(graph, intents).would_run_wrong


def test_edge_only_wiring_of_historical_retrieval_does_not_change_native_binding_config() -> None:
    graph: Graph = {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "r",
                "type": "custom",
                "data": {
                    "type": "knowledge-retrieval",
                    "title": "Knowledge",
                    "dataset_ids": ["kb-1"],
                    "query_variable_selector": ["s", "query"],
                    "retrieval_mode": "multiple",
                },
            },
        ],
        "edges": [],
    }
    before = copy.deepcopy(graph)
    intent = MutationIntent(op="connect", args={"from_node": "s", "to_node": "r"})

    vetted = vet_intents(graph, [intent])

    assert vetted.applicable == [intent]
    assert vetted.rejections == []
    assert graph == before


def test_repair_validation_details_distinguish_structural_native_and_semantic_without_values() -> None:
    structural = vet_intents(
        _scoring_graph(),
        [
            MutationIntent(
                op="set_node_config",
                args={"node_id": "branch", "path": "cases.900.conditions", "value": "SECRET_VALUE"},
            )
        ],
    )
    assert structural.validation_details[0]["stage"] == "operation"
    assert structural.validation_details[0]["reason_code"] == "invalid_path"
    assert structural.validation_details[0]["op"] == "set_node_config"
    assert structural.validation_details[0]["path"] == ["cases", "*", "conditions"]

    native = vet_intents(
        _scoring_graph(),
        [
            MutationIntent(
                op="set_node_config",
                args={"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "SECRET_VALUE"},
            )
        ],
    )
    assert native.validation_details[0]["stage"] == "native_config"
    assert native.validation_details[0]["reason_code"] == "literal_error"
    assert native.validation_details[0]["path"] == ["cases", "*", "conditions", "*", "comparison_operator"]
    assert native.validation_details[0]["node_index"] == 1
    assert native.would_run_wrong == []
    assert "SECRET_VALUE" not in json.dumps(native.validation_details)
    output_graph = _code_node(code="def main():\n    return {}", code_language="python3", outputs={}, variables=[])
    output_refusal = vet_intents(
        output_graph,
        [
            MutationIntent(
                op="set_node_config",
                args={
                    "node_id": "code1",
                    "path": "outputs",
                    "value": {
                        "SECRET_OUTPUT_NAME": {"type": "SECRET_TYPE", "children": {"SECRET_NESTED": "SECRET_VALUE"}}
                    },
                },
            )
        ],
    )
    assert output_refusal.validation_details
    assert all(detail["stage"] == "native_config" for detail in output_refusal.validation_details)
    assert "SECRET" not in json.dumps(output_refusal.validation_details)


def test_validation_metadata_never_copies_unknown_operation_node_or_path_strings() -> None:
    marker = "SECRET_MARKER"
    graph = _scoring_graph()
    graph["nodes"][1]["id"] = marker
    refused = vet_intents(
        graph,
        [
            MutationIntent(
                op="set_node_config",
                args={"node_id": marker, "path": marker + "." + "x" * 10000, "value": {marker: marker}},
            ),
            MutationIntent(op=marker, args={marker: marker}),
        ],
    )
    assert len(refused.validation_details) == 2
    assert refused.validation_details[0]["node_index"] == 1
    assert refused.validation_details[0]["path"] == ["unknown", "unknown"]
    assert refused.validation_details[1]["reason_code"] == "unknown_operation"
    assert "op" not in refused.validation_details[1]
    assert marker not in json.dumps(refused.validation_details)
    assert "x" * 100 not in json.dumps(refused.validation_details)


@pytest.mark.parametrize(
    ("op", "args", "reason"),
    [
        ("private-unknown-op", {"value": "__DIFY_BUILDER_REDACTED__"}, "unknown_operation"),
        ("set_node_config", {"value": "__DIFY_BUILDER_REDACTED__"}, "missing_argument"),
        (
            "set_node_config",
            {"node_id": "branch", "path": "title", "value": "__DIFY_BUILDER_REDACTED__"},
            "redacted_value",
        ),
    ],
)
def test_validation_observation_preserves_existing_first_refusal_priority(
    op: str, args: dict[str, object], reason: str
) -> None:
    vetted = vet_intents(_scoring_graph(), [MutationIntent(op=op, args=args)])
    assert vetted.applicable == []
    assert len(vetted.rejections) == 1
    assert vetted.validation_details[0]["reason_code"] == reason
    assert "__DIFY_BUILDER_REDACTED__" not in json.dumps(vetted.validation_details)


def test_native_validation_crash_is_fixed_unknown_category_without_exception_text() -> None:
    graph: Graph = {"nodes": [_http_node("h", {"type": "no-auth"})], "edges": []}
    vetted = vet_intents(
        graph,
        [
            MutationIntent(
                op="set_node_config",
                args={
                    "node_id": "h",
                    "path": "authorization",
                    "value": {"type": "PRIVATE_INVALID_AUTH", "config": {"type": "bearer", "api_key": "PRIVATE_TOKEN"}},
                },
            )
        ],
    )
    assert vetted.validation_details == (
        {"stage": "native_config", "reason_code": "native_validation_exception", "node_index": 0},
    )
    assert "PRIVATE_TOKEN" not in json.dumps(vetted.validation_details)
    assert vetted.would_run_wrong == []

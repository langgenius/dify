"""``preflight_errors``: the dry ``Graph.init`` a draft is put through before
it is written or run. Exercised on the REAL ESQ1-303 dev draft (app 0f11bedc,
dumped from dev on 2026-09-21), which the engine refused to start.

Plus the two layers built on it: ``new_preflight_problems`` (the new-problems-only
rule ``apply_repair`` refuses a write on) and ``vet_intents`` (the whole engine
check a proposed batch passes before it can reach an approval gate)."""

import copy
import json
from pathlib import Path

import pytest

from core.dify_builder.models import MutationIntent
from core.workflow.graph_normalizers import heal_nodes_for_preflight
from core.workflow.node_factory import validate_node_config
from services.dify_builder import graph_ops
from services.dify_builder.preflight import new_preflight_problems, preflight_errors, vet_intents

_FIXTURES = Path(__file__).parent / "fixtures"


def _esq1_303_draft() -> dict:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))


def test_the_esq1_303_dev_draft_would_not_start_and_the_error_names_the_node():
    errors = preflight_errors(_esq1_303_draft())

    assert len(errors) == 1
    assert errors[0].startswith("node 'node2' (if-else): ")
    assert "Input should be a valid string" in errors[0]  # value 60 is a JSON number


def test_the_same_draft_passes_once_the_value_is_a_string():
    graph = _esq1_303_draft()
    node2 = next(n for n in graph["nodes"] if n["id"] == "node2")
    node2["data"]["cases"][0]["conditions"][0]["value"] = "60"

    assert preflight_errors(graph) == []


def test_every_broken_node_is_reported_not_only_the_first():
    graph = _esq1_303_draft()
    broken_twice = copy.deepcopy(next(n for n in graph["nodes"] if n["id"] == "node2"))
    broken_twice["id"] = "node2b"
    graph["nodes"].append(broken_twice)

    errors = preflight_errors(graph)

    assert [e.split(" ")[1] for e in errors] == ["'node2'", "'node2b'"]


def test_note_widgets_are_skipped_exactly_like_graph_init_skips_them():
    graph = {
        "nodes": [
            {"id": "note", "type": "custom-note", "data": {"type": "", "text": "remember"}},
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
        ],
        "edges": [],
    }

    assert preflight_errors(graph) == []


def test_an_empty_or_shapeless_graph_has_nothing_to_report():
    assert preflight_errors({}) == []
    assert preflight_errors({"nodes": [None, "junk"], "edges": []}) == []


def _http_node(node_id: str, authorization: dict) -> dict:
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


def test_an_authorization_without_type_is_reported_not_raised():
    """The live E2E crash: graphon's ``HttpRequestNodeAuthorization.check_config``
    reads ``values.data["type"]``, which is absent once the required ``type``
    failed, so it raises KeyError -- which pydantic does not wrap and
    ``validate_node_config`` does not catch. A validation step must report
    it, never crash the Builder session. Built WITHOUT the normalizer."""
    graph = {"nodes": [_http_node("h", {"config": {"type": "bearer", "api_key": "x"}})], "edges": []}

    errors = preflight_errors(graph)

    assert errors == ["node 'h' (http-request): KeyError: 'type'"]


# Exactly which ``authorization`` shapes reach ``_CRASH_LOCATION``. The rule is
# not "no ``type``" -- graphon's ``check_config`` is a ``mode="before"`` validator
# on ``config``, so it only runs when a ``config`` KEY is present, and it then
# reads ``values.data["type"]``, which is absent whenever ``type`` failed its own
# Literal check. That comment has been written wrong twice; this pins it.
_CRASH_AUTHORIZATION_SHAPES = [
    ({"config": {"type": "bearer", "api_key": "x"}}, True),
    ({"type": None, "config": {"type": "bearer", "api_key": "x"}}, True),
    ({"type": "bogus", "config": {"type": "bearer", "api_key": "x"}}, True),
    ({}, False),
    ({"type": None}, False),
]


@pytest.mark.parametrize(("authorization", "crashes"), _CRASH_AUTHORIZATION_SHAPES)
def test_only_an_authorization_with_a_config_and_a_bad_type_crashes(authorization: dict, crashes: bool):
    errors = preflight_errors({"nodes": [_http_node("h", authorization)], "edges": []})

    assert len(errors) == 1
    if crashes:
        assert errors[0] == "node 'h' (http-request): KeyError: 'type'"
    else:
        # an ordinary ValidationError, with a real field path
        assert "KeyError" not in errors[0]
        assert "authorization.type" in errors[0]


def test_a_crashing_node_does_not_hide_the_problems_of_the_nodes_after_it():
    graph = _esq1_303_draft()
    graph["nodes"].insert(0, _http_node("h", {"type": "bearer", "config": {"type": "bearer", "api_key": "x"}}))

    errors = preflight_errors(graph)

    assert [e.split(" ")[1] for e in errors] == ["'h'", "'node2'"]
    assert errors[0].startswith("node 'h' (http-request): KeyError: ")
    assert errors[1].startswith("node 'node2' (if-else): ")  # ValueError messages unchanged


# ---- new_preflight_problems --------------------------------------------------


def _scoring_graph(operator: str = "≥", value: object = "60") -> dict:
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


def test_the_base_draft_this_file_edits_starts_clean():
    assert preflight_errors(_scoring_graph()) == []


def test_a_problem_the_draft_already_had_is_not_new():
    broken = _scoring_graph(operator="==")

    assert preflight_errors(broken)  # it is a problem
    assert new_preflight_problems(broken, broken, ()) == []  # ...just not a new one


def test_a_problem_the_change_introduced_is_new_and_quotes_the_engine():
    problems = new_preflight_problems(_scoring_graph(), _scoring_graph(operator="=="), ())

    assert len(problems) == 1
    assert problems[0].startswith("node 'branch' (if-else): ")
    assert "comparison_operator" in problems[0]


def test_a_change_that_heals_a_pre_existing_problem_has_nothing_to_report():
    assert new_preflight_problems(_scoring_graph(operator="=="), _scoring_graph(), ()) == []


def test_a_newly_broken_node_is_reported_even_while_another_stays_broken():
    """A pre-existing refusal on one node does not buy silence for the rest of
    the draft: the if-else was already refused, the start node was not."""
    before = _scoring_graph(operator="==")
    after = copy.deepcopy(before)
    after["nodes"][0]["data"]["variables"][0]["type"] = "not-a-type"

    problems = new_preflight_problems(before, after, ())

    assert [p.split(" ")[1] for p in problems] == ["'start'"]


def _code_node(**data) -> dict:
    return {
        "nodes": [{"id": "code1", "type": "custom", "data": {"type": "code", "title": "Code", **data}}],
        "edges": [],
    }


def test_half_repairing_an_already_broken_node_is_not_a_new_problem():
    """Why the rule is not keyed on MESSAGE TEXT: pydantic quotes a truncated
    repr of the input, so filling one of a node's missing fields rewrites the
    messages for the others. Keyed on text, this repair -- which strictly
    improved the node -- would be refused as a new problem."""
    before = _code_node()
    after = _code_node(code="def main():\n    return {}")

    assert preflight_errors(before) != preflight_errors(after)  # the text really does change
    assert preflight_errors(after)  # the node is still refused...
    assert new_preflight_problems(before, after, ()) == []  # ...but not because of this change


def test_a_node_the_batch_wrote_gets_no_exemption_at_all():
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


def test_a_half_repaired_node_the_batch_wrote_is_refused_even_though_it_improved():
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


def test_a_node_the_batch_wrote_and_actually_fixed_reports_nothing():
    """The rule is "startable", not "was touched": a repair that really works
    passes, or every Fix would be refused."""
    before = _code_node()
    after = _code_node(code="def main():\n    return {}", code_language="python3", outputs={}, variables=[])

    assert preflight_errors(after) == []
    assert new_preflight_problems(before, after, ["code1"]) == []


def test_an_untouched_node_keeps_its_exemption_while_a_written_one_does_not():
    """Both rules in one graph, so neither can quietly become the other."""
    before = {"nodes": [*_code_node()["nodes"], *_code_node()["nodes"]], "edges": []}
    before["nodes"][1] = {**before["nodes"][1], "id": "code2"}
    after = copy.deepcopy(before)

    problems = new_preflight_problems(before, after, ["code2"])

    assert [p.split(" ")[1] for p in problems] == ["'code2'"]


def test_an_already_invalid_node_broken_further_is_a_new_problem():
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


def test_a_recreated_id_of_a_different_type_is_a_new_node():
    before = {"nodes": [{"id": "n1", "type": "custom", "data": {"type": "code", "title": "Code"}}], "edges": []}
    after = {"nodes": [{"id": "n1", "type": "custom", "data": {"type": "llm", "title": "LLM"}}], "edges": []}

    problems = new_preflight_problems(before, after, ())

    assert len(problems) == 1
    assert problems[0].startswith("node 'n1' (llm): ")


# ---- vet_intents -------------------------------------------------------------

_ALLOWED = {"if-else", "start", "llm", "end", "template-transform"}


def _operator_of(graph: dict) -> str:
    """The one condition operator ``_scoring_graph`` carries."""
    branch = next(n for n in graph["nodes"] if n["id"] == "branch")
    return branch["data"]["cases"][0]["conditions"][0]["comparison_operator"]


def _set_operator(value: str) -> MutationIntent:
    return MutationIntent(
        op="set_node_config",
        args={"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": value},
    )


def test_a_batch_the_engine_accepts_has_no_rejections():
    vetted = vet_intents(_scoring_graph(), [_set_operator("≤")], _ALLOWED)

    assert vetted.rejections == []
    assert len(vetted.applicable) == 1


def test_a_structural_refusal_is_quoted_from_the_engines_own_error():
    intent = MutationIntent(op="set_node_config", args={"node_id": "ghost", "path": "title", "value": "x"})

    vetted = vet_intents(_scoring_graph(), [intent], _ALLOWED)

    assert vetted.applicable == []
    assert len(vetted.rejections) == 1
    assert "node not found: ghost" in vetted.rejections[0]


# ---- the rejection text must not carry the node's credentials ----


_SECRET_KEY = "sk-live-9f3c-SECRET"
_SECRET_HEADER = "tok-999-SECRET"


_AUTHORIZATION = {"type": "api-key", "config": {"type": "bearer", "header": "X-Auth", "api_key": _SECRET_KEY}}
_HEADERS = f"Authorization: Bearer {_SECRET_HEADER}"


def _secret_http_node(data: dict) -> dict:
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
def test_the_refusal_text_withholds_the_nodes_credentials(data: dict, leaked: str):
    """pydantic puts ``input_value=<repr of what it was given>`` in its message,
    and for a model-level error (a required field missing) that repr is the
    node's WHOLE ``data`` -- which for an http-request node is where a live
    bearer token sits. This message goes straight into a corrective re-prompt.

    The raw engine text really does carry a secret in both shapes below, so the
    redaction is load-bearing rather than belt-and-braces."""
    node = _secret_http_node(data)
    with pytest.raises(ValueError) as raw:
        validate_node_config(node)
    assert leaked in str(raw.value)  # the engine's own text leaks it...

    errors = preflight_errors({"nodes": [node], "edges": []})

    assert len(errors) == 1
    assert _SECRET_KEY not in errors[0]  # ...and this one leaks neither
    assert _SECRET_HEADER not in errors[0]
    assert errors[0].startswith("node 'h' (http-request): ")  # still says which node, and why
    assert "url" in errors[0]


_BODY_SECRET = "BODYSECRET"


def test_a_secret_in_a_request_body_is_outside_redactions_declared_scope():
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


def test_withholding_the_credential_does_not_change_the_verdict():
    """The verdict is taken from the REAL node; only the text is rebuilt from a
    redacted copy. A node that starts must not be reported because redaction
    changed it, and one that does not must still be reported."""
    valid = _secret_http_node(
        {
            "title": "Call",
            "method": "post",
            "url": "https://x.test/a",
            "authorization": _AUTHORIZATION,
            "headers": _HEADERS,
            "params": "",
            "body": {"type": "none", "data": []},
        }
    )

    assert preflight_errors({"nodes": [valid], "edges": []}) == []
    assert new_preflight_problems({"nodes": [], "edges": []}, {"nodes": [valid], "edges": []}, ["h"]) == []


def test_an_operator_no_normalizer_can_heal_is_rejected_by_the_node_data_check():
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


def test_the_unhealability_check_really_would_catch_a_healable_operator():
    """The contrast that gives the test above its teeth: run step (b) on ``>=``
    -- which IS healable -- and every one of its assertions flips."""
    graph = _scoring_graph()

    unhealed, _changed = graph_ops.apply_set_node_config(graph, **_set_operator(">=").args)

    assert heal_nodes_for_preflight(unhealed["nodes"]) == ["branch"]
    assert _operator_of(unhealed) == "≥"
    assert preflight_errors(unhealed) == []


def test_an_ascii_ordering_operator_is_healed_and_so_is_never_rejected():
    """The mirror of the test above, and the reason the brief's ``>=`` case is
    dead: ``>=`` can only mean ``≥``, the shared heal set rewrites it before the
    preflight, and the write chokepoint does the same -- so the dry run must NOT
    report it. A dry run stricter than the write burns the re-prompt on nothing."""
    graph = _scoring_graph()

    vetted = vet_intents(graph, [_set_operator(">=")], _ALLOWED)

    assert vetted.rejections == []
    assert vetted.applicable
    dry = graph_ops.filter_applicable(graph, [_set_operator(">=")])
    assert new_preflight_problems(graph, dry.graph, dry.changed_nodes) == []


def test_a_draft_the_user_already_broke_does_not_veto_an_unrelated_edit():
    """New problems only. The if-else was refused before the edit and is refused
    after it; the edit renamed a different node and must go through."""
    broken = _scoring_graph(operator="==")
    rename = MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Begin"})

    vetted = vet_intents(broken, [rename], _ALLOWED)

    assert vetted.rejections == []
    assert vetted.applicable == [rename]


def test_a_batch_that_leaves_its_own_culprit_invalid_is_refused_before_the_gate():
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


def test_wiring_an_already_broken_node_does_not_make_the_batch_answerable_for_it():
    """``touched`` is "wrote this node's DATA", not "appears in the change set".

    ``apply_connect`` reports BOTH endpoints as changed -- right for a diff,
    wrong here: an edge cannot change either endpoint's
    ``validate_node_config`` verdict. Counting them would mean that merely
    wiring a node the user already broke makes its pre-existing defect veto the
    whole batch, which is the invariant the untouched rule exists to keep."""
    already_broken = {
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


def test_a_batch_that_really_fixes_its_culprit_still_passes():
    """The other half: the same already-broken node, repaired properly, is not
    refused -- otherwise ``touched`` would veto every repair."""
    already_broken = _scoring_graph(operator="==")

    vetted = vet_intents(already_broken, [_set_operator("≥")], _ALLOWED)

    assert vetted.rejections == []
    assert len(vetted.applicable) == 1


def test_a_created_node_the_engine_would_refuse_is_named_in_the_rejection():
    """The node the batch ADDS has no "before" to compare against, so anything
    the engine refuses about it is new by definition -- and the rejection names
    the id the LLM chose, which is what makes it actionable in the re-prompt."""
    intent = MutationIntent(op="create_node", args={"node_type": "if-else", "node_id": "n9", "config": {"cases": 7}})

    vetted = vet_intents(_scoring_graph(), [intent], _ALLOWED)

    assert len(vetted.rejections) == 1
    assert "node 'n9' (if-else)" in vetted.rejections[0]


def test_a_structural_rejection_line_withholds_the_nodes_credentials():
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


def test_two_crashes_with_different_messages_are_different_problems():
    """A node whose validation raises something other than a ``ValidationError``
    has no field path, so its exception stands in for one. Keyed on the class
    ALONE, every ``KeyError`` on a node would be the same problem and a change
    that swapped one crashing shape for another would pass unnoticed, so the
    (truncated) message is part of the key.

    Reaches for the private key builder deliberately: graphon has exactly one
    live bare-crash site today (``HttpRequestNodeAuthorization.check_config``,
    always ``KeyError: 'type'``), so there is no pair of real nodes that differs
    only in the crash message -- this pins the rule before there is."""
    from services.dify_builder.preflight import _CRASH_LOCATION, _error_locations

    first = _error_locations(KeyError("type"))
    second = _error_locations(KeyError("method"))

    assert first != second
    assert first == frozenset({(_CRASH_LOCATION, "KeyError", "'type'")})
    assert _error_locations(KeyError("type")) == first  # and the SAME crash is still the same problem


def test_a_crash_message_never_reaches_the_text_the_model_is_shown():
    """The crash message is the one part of a location not derived from a field
    path, so it is the one part that could echo a value out of the node. It is
    keyed on, never rendered."""
    from services.dify_builder.preflight import _CRASH_LOCATION, _location_label

    assert _location_label((_CRASH_LOCATION, "KeyError", "'sk-live-SECRET'")) == "<crash>.KeyError"
    assert _location_label(("cases", "0", "comparison_operator")) == "cases.0.comparison_operator"

"""Pure graph normalizers shared by the workflow generator's postprocess (cmd+K
``/create`` and ``/refine``) and the Dify Builder's ``apply_repair`` chokepoint.

The if-else cases run against the REAL ESQ1-303 dev draft (app 0f11bedc,
dumped 2026-09-21), which graphon refused to start because ``value`` was the
JSON number 60 (``Condition.value: str | Sequence[str] | bool | None``)."""

import copy
import json
from pathlib import Path

import pytest

from core.workflow.graph_normalizers import (
    heal_nodes_for_preflight,
    normalize_condition_value,
    normalize_conditions,
    normalize_filter_condition_value,
)

_FIXTURES = Path(__file__).parent / "fixtures"


def _esq1_303_nodes() -> list[dict]:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))["nodes"]


def _if_else_value(nodes: list[dict], node_id: str = "node2"):
    node = next(n for n in nodes if n["id"] == node_id)
    return node["data"]["cases"][0]["conditions"][0]["value"]


class TestNormalizeConditionValue:
    def test_numbers_become_strings(self):
        assert normalize_condition_value(60, "=") == "60"
        assert normalize_condition_value(60.0, "=") == "60"  # an integral float is not "60.0"
        assert normalize_condition_value(60.5, ">") == "60.5"
        assert normalize_condition_value(0, "=") == "0"
        assert normalize_condition_value(1, "=") == "1"  # pydantic would coerce int 1 to True

    def test_bool_is_checked_before_int_and_preserved(self):
        assert normalize_condition_value(True, "is") is True
        assert normalize_condition_value(False, "is") is False

    def test_strings_none_and_string_lists_pass_through(self):
        assert normalize_condition_value("60", "=") == "60"
        assert normalize_condition_value(None, "empty") is None
        assert normalize_condition_value(["a", "b"], "in") == ["a", "b"]

    def test_list_items_are_coerced_to_strings(self):
        assert normalize_condition_value([1, "b", 2.5, True], "in") == ["1", "b", "2.5", "True"]

    def test_a_scalar_under_a_list_operator_becomes_a_one_item_list(self):
        assert normalize_condition_value(3, "in") == ["3"]
        assert normalize_condition_value(3, "not in") == ["3"]
        assert normalize_condition_value(3, "all of") == ["3"]
        assert normalize_condition_value("x", "in") == ["x"]

    def test_list_items_use_integral_float_rule(self):
        # integral floats in lists should become strings without decimal point
        assert normalize_condition_value([1.0, 2.5], "=") == ["1", "2.5"]


class TestNormalizeFilterConditionValue:
    def test_none_becomes_empty_string(self):
        assert normalize_filter_condition_value(None) == ""

    def test_bool_is_preserved(self):
        assert normalize_filter_condition_value(True) is True
        assert normalize_filter_condition_value(False) is False

    def test_numbers_become_strings_not_lists(self):
        assert normalize_filter_condition_value(7) == "7"
        assert normalize_filter_condition_value(7.0) == "7"
        assert normalize_filter_condition_value(7.5) == "7.5"

    def test_strings_pass_through(self):
        assert normalize_filter_condition_value("value") == "value"

    def test_list_items_normalized_no_wrapping(self):
        # Unlike Condition, we don't wrap in a list—we keep the list but normalize items
        assert normalize_filter_condition_value(["a", 2]) == ["a", "2"]
        assert normalize_filter_condition_value([1.0, "b"]) == ["1", "b"]

    def test_takes_the_shared_value_operator_signature_and_ignores_the_operator(self):
        # Same ``(value, operator)`` shape as normalize_condition_value, so the
        # conditions walker calls both one way -- but a list operator never
        # wraps a FilterCondition scalar into a list.
        assert normalize_filter_condition_value(3, "in") == "3"
        assert normalize_filter_condition_value("x", "all of") == "x"
        assert normalize_filter_condition_value(None, "empty") == ""


class TestNormalizeConditionsDispatch:
    def test_a_type_error_inside_a_value_normalizer_is_not_masked(self):
        # The walker used to retry any TypeError as a one-argument call, which
        # replaced a genuine bug's error with an unrelated "missing argument".
        from core.workflow.graph_normalizers import _normalize_condition_list

        def broken(_value, _operator):
            raise TypeError("genuine bug")

        with pytest.raises(TypeError, match="genuine bug"):
            _normalize_condition_list([{"comparison_operator": "=", "value": 1}], broken)


class TestNormalizeConditions:
    def test_heals_the_esq1_303_dev_draft_and_names_the_node(self):
        nodes = _esq1_303_nodes()
        assert _if_else_value(nodes) == 60

        changed = normalize_conditions(nodes)

        assert changed == ["node2"]
        assert _if_else_value(nodes) == "60"

    def test_is_idempotent_and_reports_nothing_on_a_clean_graph(self):
        nodes = _esq1_303_nodes()
        normalize_conditions(nodes)

        assert normalize_conditions(nodes) == []

    def test_covers_sub_variable_conditions_loop_break_conditions_and_list_operator_filters(self):
        nodes = [
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "variable_selector": ["s", "files"],
                                    "comparison_operator": "contains",
                                    "value": None,
                                    "sub_variable_condition": {
                                        "logical_operator": "and",
                                        "conditions": [{"key": "size", "comparison_operator": ">", "value": 1024}],
                                    },
                                }
                            ],
                        }
                    ],
                },
            },
            {
                "id": "loop",
                "data": {
                    "type": "loop",
                    "break_conditions": [{"variable_selector": ["loop", "i"], "comparison_operator": "≥", "value": 10}],
                },
            },
            {
                "id": "filter",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "n", "comparison_operator": "in", "value": 7}],
                    },
                },
            },
            {"id": "legacy", "data": {"type": "if-else", "conditions": [{"comparison_operator": "=", "value": 2}]}},
        ]

        changed = normalize_conditions(nodes)

        assert changed == ["branch", "loop", "filter", "legacy"]
        sub = nodes[0]["data"]["cases"][0]["conditions"][0]["sub_variable_condition"]["conditions"][0]
        assert sub["value"] == "1024"
        assert nodes[1]["data"]["break_conditions"][0]["value"] == "10"
        assert nodes[2]["data"]["filter_by"]["conditions"][0]["value"] == "7"
        assert nodes[3]["data"]["conditions"][0]["value"] == "2"

    def test_other_node_types_and_malformed_shapes_are_left_alone(self):
        nodes = [
            {"id": "llm", "data": {"type": "llm", "value": 3}},
            {"id": "odd", "data": {"type": "if-else", "cases": "not-a-list"}},
            {"id": "odd2", "data": {"type": "if-else", "cases": [{"conditions": ["junk", None]}]}},
            "not-a-node",
        ]
        before = copy.deepcopy(nodes)

        assert normalize_conditions(nodes) == []
        assert nodes == before

    def test_list_operator_with_none_bool_and_lists(self):
        """List-operator filters follow FilterCondition (None → "", no wrapping)."""
        nodes = [
            {
                "id": "filter_none",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "empty", "value": None}],
                    },
                },
            },
            {
                "id": "filter_bool",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "is", "value": True}],
                    },
                },
            },
            {
                "id": "filter_list",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "in", "value": ["a", 2]}],
                    },
                },
            },
        ]

        changed = normalize_conditions(nodes)

        # filter_none changed (None → ""), filter_list changed (items normalized)
        # filter_bool unchanged (True stays True)
        assert "filter_none" in changed
        assert "filter_list" in changed
        assert "filter_bool" not in changed
        assert nodes[0]["data"]["filter_by"]["conditions"][0]["value"] == ""
        assert nodes[1]["data"]["filter_by"]["conditions"][0]["value"] is True
        assert nodes[2]["data"]["filter_by"]["conditions"][0]["value"] == ["a", "2"]


class TestCanonicalizeComparisonOperators:
    """graphon's ``SupportedComparisonOperator`` (``utils/condition/entities.py``)
    and the list-operator's ``FilterOperator`` both spell the two ordering
    comparisons ``≥`` / ``≤``; an LLM routinely writes ``>=`` / ``<=``, which
    pydantic refuses at ``Graph.init``.

    ONLY those two are canonicalized. Every equality-family ASCII form is
    ambiguous: graphon's string equality is ``is`` / ``is not``
    (``_assert_is`` accepts ``str | bool``) and its number equality is ``=`` /
    ``≠`` (``_assert_equal`` accepts only numbers/bools), so ``==`` could mean
    either and ``!=`` / ``<>`` likewise -- exactly the ambiguity that keeps
    ``equals`` / ``gte`` rejected. The ordering forms carry no such ambiguity:
    graphon has no string ordering operator at all (``_assert_greater_than``
    and friends raise "Invalid actual value type: number" for anything but a
    number), so ``>=`` can only mean ``≥``."""

    def _if_else(self, operator: str, value: object = "9") -> list[dict]:
        return [
            {
                "id": "node2",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "variable_selector": ["node1", "score"],
                                    "comparison_operator": operator,
                                    "value": value,
                                }
                            ],
                        }
                    ],
                },
            }
        ]

    def test_ascii_ordering_operators_become_the_engine_literals(self):
        for ascii_form, literal in ((">=", "≥"), ("<=", "≤")):
            nodes = self._if_else(ascii_form)

            assert normalize_conditions(nodes) == ["node2"]
            assert nodes[0]["data"]["cases"][0]["conditions"][0]["comparison_operator"] == literal

    def test_every_container_is_covered(self):
        nodes = [
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "variable_selector": ["s", "files"],
                                    "comparison_operator": ">=",
                                    "value": "1",
                                    "sub_variable_condition": {
                                        "logical_operator": "and",
                                        "conditions": [{"key": "size", "comparison_operator": "<=", "value": "1024"}],
                                    },
                                }
                            ],
                        }
                    ],
                },
            },
            {
                "id": "loop",
                "data": {
                    "type": "loop",
                    "break_conditions": [
                        {"variable_selector": ["loop", "i"], "comparison_operator": ">=", "value": "10"}
                    ],
                },
            },
            {
                "id": "filter",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "n", "comparison_operator": "<=", "value": "7"}],
                    },
                },
            },
            {
                "id": "legacy",
                "data": {"type": "if-else", "conditions": [{"comparison_operator": ">=", "value": "2"}]},
            },
        ]

        assert normalize_conditions(nodes) == ["branch", "loop", "filter", "legacy"]

        case_condition = nodes[0]["data"]["cases"][0]["conditions"][0]
        assert case_condition["comparison_operator"] == "≥"
        assert case_condition["sub_variable_condition"]["conditions"][0]["comparison_operator"] == "≤"
        assert nodes[1]["data"]["break_conditions"][0]["comparison_operator"] == "≥"
        assert nodes[2]["data"]["filter_by"]["conditions"][0]["comparison_operator"] == "≤"
        assert nodes[3]["data"]["conditions"][0]["comparison_operator"] == "≥"

    @pytest.mark.parametrize(
        "operator",
        [
            "=",
            "≠",
            ">",
            "<",
            "≥",
            "≤",
            "is",
            "is not",
            "contains",
            "not contains",
            "start with",
            "end with",
            "in",
            "not in",
            "all of",
            "empty",
            "not empty",
            "null",
            "not null",
            "exists",
            "not exists",
        ],
    )
    def test_an_operator_the_engine_accepts_is_left_alone(self, operator: str):
        # ``in`` / ``not in`` / ``all of`` compare against a list, so they get a
        # list value: this asserts the OPERATOR is untouched, not the
        # pre-existing scalar-to-list value rule.
        nodes = self._if_else(operator, ["9"] if operator in ("in", "not in", "all of") else "9")
        before = copy.deepcopy(nodes)

        assert normalize_conditions(nodes) == []
        assert nodes == before

    @pytest.mark.parametrize("operator", ["==", "!=", "<>", "equals", "not equals", "gte", "lte", "eq", "ne", "gt"])
    def test_an_ambiguous_form_keeps_failing_loudly(self, operator: str):
        # Every equality-family ASCII form is ambiguous between the number
        # operator (``=`` / ``≠``) and the string operator (``is`` / ``is
        # not``), as are all the word forms. Guessing would silently change
        # which comparison the draft runs; the engine must refuse them instead.
        nodes = self._if_else(operator)
        before = copy.deepcopy(nodes)

        assert normalize_conditions(nodes) == []
        assert nodes == before

    def test_the_operator_is_canonicalized_before_the_value_rule_reads_it(self):
        # ``normalize_condition_value`` keys on the operator (a scalar under
        # ``in`` / ``not in`` / ``all of`` becomes a one-item list), so it must
        # never see an operator the engine is about to reject.
        from core.workflow.graph_normalizers import _normalize_condition_list

        seen: list[str] = []

        def record(value, operator):
            seen.append(operator)
            return value

        conditions = [{"comparison_operator": ">=", "value": "9"}]
        assert _normalize_condition_list(conditions, record) is True
        assert seen == ["≥"]

    def test_a_missing_or_malformed_operator_is_left_alone(self):
        nodes = [
            {"id": "a", "data": {"type": "if-else", "cases": [{"conditions": [{"value": "x"}]}]}},
            {"id": "b", "data": {"type": "if-else", "cases": [{"conditions": [{"comparison_operator": None}]}]}},
        ]
        before = copy.deepcopy(nodes)

        assert normalize_conditions(nodes) == []
        assert nodes == before


class TestHealNodesForPreflight:
    """The one deterministic heal set every pre-preflight caller runs, so the
    Builder's write chokepoint and the dry run that decides which intents are
    applicable cannot drift apart."""

    def test_runs_the_whole_set_and_dedupes_the_ids_in_order(self):
        nodes = [
            {
                "id": "node2",
                "data": {
                    "type": "if-else",
                    "cases": [{"case_id": "true", "conditions": [{"comparison_operator": ">=", "value": 90}]}],
                },
            },
            {
                "id": "node3",
                "data": {
                    "type": "http-request",
                    "body": {"type": "json", "data": [{"key": "", "value": "{}"}]},
                },
            },
            {"id": "node4", "data": {"type": "parameter-extractor", "query": [["node2", "text"]]}},
        ]

        assert heal_nodes_for_preflight(nodes) == ["node2", "node3", "node4"]

        condition = nodes[0]["data"]["cases"][0]["conditions"][0]
        assert condition["comparison_operator"] == "≥"
        assert condition["value"] == "90"
        assert nodes[1]["data"]["body"]["data"][0]["type"] == "text"
        assert nodes[2]["data"]["query"] == ["node2", "text"]

    def test_reports_a_node_once_even_when_two_normalizers_heal_it(self):
        # An http-request node whose authorization AND body both need filling
        # is still one changed id; so is a re-run over an already-healed graph.
        nodes = [
            {
                "id": "node3",
                "data": {
                    "type": "http-request",
                    "authorization": {"config": None},
                    "body": {"type": "json", "data": [{"key": "", "value": "{}"}]},
                },
            }
        ]

        assert heal_nodes_for_preflight(nodes) == ["node3"]
        assert heal_nodes_for_preflight(nodes) == []

    def test_leaves_a_graph_the_engine_already_accepts_untouched(self):
        nodes = _esq1_303_nodes()
        heal_nodes_for_preflight(nodes)
        before = copy.deepcopy(nodes)

        assert heal_nodes_for_preflight(nodes) == []
        assert nodes == before


class TestDeriveIfElseVarTypes:
    """``varType`` is a frontend-only hint the canvas uses to pick the operator
    list; the runtime ignores it. Builder-made if-else nodes never carried it
    (ESQ1-303: all three on dev lacked it, none of 14 human-made ones did), which
    steers the panel to string operators on a number. Derive it only when it is
    certain -- from a declared start-variable type -- and never guess."""

    def test_derives_number_from_the_esq1_303_start_variable(self):
        from core.workflow.graph_normalizers import derive_if_else_var_types

        nodes = _esq1_303_nodes()
        condition = next(n for n in nodes if n["id"] == "node2")["data"]["cases"][0]["conditions"][0]
        assert "varType" not in condition

        assert derive_if_else_var_types(nodes) == ["node2"]
        assert condition["varType"] == "number"

    def test_maps_every_certain_start_type_and_nothing_else(self):
        from core.workflow.graph_normalizers import derive_if_else_var_types

        def cond(var: str) -> dict:
            return {"id": var, "variable_selector": ["start", var], "comparison_operator": "is", "value": ""}

        nodes = [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [
                        {"variable": "n", "type": "number"},
                        {"variable": "t", "type": "text-input"},
                        {"variable": "p", "type": "paragraph"},
                        {"variable": "s", "type": "select"},
                        {"variable": "u", "type": "url"},
                        {"variable": "c", "type": "checkbox"},
                        {"variable": "f", "type": "file"},
                        {"variable": "fl", "type": "file-list"},
                        {"variable": "j", "type": "json"},
                    ],
                },
            },
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [cond(v) for v in ["n", "t", "p", "s", "u", "c", "f", "fl", "j"]],
                        }
                    ],
                },
            },
        ]

        derive_if_else_var_types(nodes)

        got = {c["id"]: c.get("varType") for c in nodes[1]["data"]["cases"][0]["conditions"]}
        assert got == {
            "n": "number",
            "t": "string",
            "p": "string",
            "s": "string",
            "u": "string",
            "c": "boolean",
            "f": "file",
            "fl": "array[file]",
            "j": None,  # not certain -> omitted
        }

    def test_leaves_existing_non_start_and_sys_selectors_alone(self):
        from core.workflow.graph_normalizers import derive_if_else_var_types

        nodes = [
            {"id": "start", "data": {"type": "start", "variables": [{"variable": "n", "type": "number"}]}},
            {"id": "llm", "data": {"type": "llm"}},
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {"id": "a", "variable_selector": ["start", "n"], "varType": "string", "value": "1"},
                                {"id": "b", "variable_selector": ["llm", "text"], "value": "x"},
                                {"id": "c", "variable_selector": ["sys", "query"], "value": "x"},
                                {"id": "d", "variable_selector": ["start", "missing"], "value": "x"},
                            ],
                        }
                    ],
                },
            },
        ]

        assert derive_if_else_var_types(nodes) == []
        conds = {c["id"]: c for c in nodes[2]["data"]["cases"][0]["conditions"]}
        assert conds["a"]["varType"] == "string"  # explicit values are never overwritten
        assert "varType" not in conds["b"]
        assert "varType" not in conds["c"]
        assert "varType" not in conds["d"]


# The http-request node exactly as the ESQ1-302 draft stored it (dev app
# a26c8d2b, node4): a json body whose two items lack ``type``. graphon's
# ``BodyData.type: Literal["file", "text"]`` has no default, so Graph.init
# rejected the node on every test run; and even with ``type`` filled, the
# executor requires EXACTLY ONE item for json / raw-text / binary bodies.
ESQ1_302_HTTP_NODE = {
    "id": "node4",
    "type": "custom",
    "data": {
        "type": "http-request",
        "title": "Call PPT API",
        "method": "post",
        "url": "https://api.example.com/ppt/generate",
        "authorization": {"config": None, "type": "no-auth"},
        "headers": "",
        "params": "",
        "body": {
            "type": "json",
            "data": [
                {"value": "{{#node3.text#}}", "key": "slides"},
                {"value": "{{#node1.output_filename#}}", "key": "filename"},
            ],
        },
    },
}


class TestNormalizeHttpRequestBodies:
    def test_fills_the_missing_item_type_on_the_esq1_302_node(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = copy.deepcopy(ESQ1_302_HTTP_NODE)

        assert normalize_http_request_bodies([node]) == ["node4"]
        assert [item["type"] for item in node["data"]["body"]["data"]] == ["text", "text"]

    def test_an_item_carrying_a_file_selector_is_a_file_item(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = {
            "id": "up",
            "data": {
                "type": "http-request",
                "body": {
                    "type": "form-data",
                    "data": [{"key": "doc", "file": ["node1", "doc"]}, {"key": "name", "value": "x"}],
                },
            },
        }

        normalize_http_request_bodies([node])

        assert [item["type"] for item in node["data"]["body"]["data"]] == ["file", "text"]

    def test_a_none_body_drops_stray_items(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = {
            "id": "get",
            "data": {
                "type": "http-request",
                "body": {"type": "none", "data": [{"key": "x", "value": "y"}]},
            },
        }

        assert normalize_http_request_bodies([node]) == ["get"]
        assert node["data"]["body"]["data"] == []

    def test_a_string_body_and_a_clean_body_are_left_alone(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        nodes = [
            {
                "id": "s",
                "data": {"type": "http-request", "body": {"type": "raw-text", "data": "plain"}},
            },
            {
                "id": "c",
                "data": {
                    "type": "http-request",
                    "body": {"type": "json", "data": [{"type": "text", "key": "", "value": "{}"}]},
                },
            },
            {
                "id": "llm",
                "data": {"type": "llm", "body": {"type": "json", "data": [{"key": "x"}]}},
            },
        ]
        before = copy.deepcopy(nodes)

        assert normalize_http_request_bodies(nodes) == []
        assert nodes == before


class TestNormalizeHttpRequestAuthorization:
    """A generated ``authorization`` without ``type`` makes graphon's
    ``HttpRequestNodeAuthorization.check_config`` raise KeyError (the live
    E2E Build crash). The shared http normalizer fills it: ``api-key`` when
    the config carries a key, else ``no-auth``."""

    @staticmethod
    def _node(authorization) -> dict:
        return {
            "id": "h",
            "data": {"type": "http-request", "authorization": authorization, "body": {"type": "none", "data": []}},
        }

    def test_a_config_carrying_an_api_key_becomes_api_key(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = self._node({"config": {"type": "bearer", "api_key": "x"}})

        assert normalize_http_request_bodies([node]) == ["h"]
        assert node["data"]["authorization"] == {"type": "api-key", "config": {"type": "bearer", "api_key": "x"}}

    def test_an_empty_authorization_becomes_no_auth(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = self._node({})

        assert normalize_http_request_bodies([node]) == ["h"]
        assert node["data"]["authorization"] == {"type": "no-auth", "config": None}

    def test_a_config_without_a_key_becomes_no_auth(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        node = self._node({"config": {"type": "bearer", "api_key": ""}})

        assert normalize_http_request_bodies([node]) == ["h"]
        assert node["data"]["authorization"] == {"type": "no-auth", "config": None}

    def test_an_authorization_with_a_type_or_not_a_dict_is_left_alone(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        nodes = [
            self._node({"type": "api-key", "config": {"type": "bearer", "api_key": "x"}}),
            self._node({"type": "no-auth", "config": None}),
            self._node(None),
        ]
        before = copy.deepcopy(nodes)

        assert normalize_http_request_bodies(nodes) == []
        assert nodes == before


class TestHttpRequestBodyErrors:
    """What the normalizer must NOT paper over: a json body with two ``{key,
    value}`` items has no single correct collapse (quoting breaks JSON-valued
    variables -- ESQ1-302's ``node3.text`` IS JSON -- and not quoting breaks
    plain text). The honest answer is a structured rejection naming the node."""

    def test_the_esq1_302_json_body_with_two_items_is_rejected_with_the_node_id(self):
        from core.workflow.graph_normalizers import http_request_body_errors

        node = copy.deepcopy(ESQ1_302_HTTP_NODE)
        errors = http_request_body_errors([node])

        assert len(errors) == 1
        node_id, detail = errors[0]
        assert node_id == "node4"
        assert "json body must have exactly one item" in detail
        assert "2 items" in detail

    def test_raw_text_and_binary_need_exactly_one_item_form_bodies_take_any_number(self):
        from core.workflow.graph_normalizers import http_request_body_errors

        def node(nid: str, body_type: str, count: int) -> dict:
            items = [{"type": "text", "key": str(i), "value": "v"} for i in range(count)]
            return {
                "id": nid,
                "data": {
                    "type": "http-request",
                    "body": {"type": body_type, "data": items},
                },
            }

        nodes = [
            node("raw0", "raw-text", 0),
            node("raw1", "raw-text", 1),
            node("bin2", "binary", 2),
            node("form0", "form-data", 0),
            node("form3", "form-data", 3),
            node("url2", "x-www-form-urlencoded", 2),
            node("none0", "none", 0),
        ]

        assert [nid for nid, _ in http_request_body_errors(nodes)] == ["raw0", "bin2"]

    def test_empty_string_bodies_are_rejected_as_having_no_items(self):
        from core.workflow.graph_normalizers import http_request_body_errors

        nodes = [
            {
                "id": "raw_empty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "raw-text", "data": ""},
                },
            },
            {
                "id": "json_empty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "json", "data": ""},
                },
            },
            {
                "id": "bin_empty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "binary", "data": ""},
                },
            },
            {
                "id": "raw_nonempty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "raw-text", "data": "valid"},
                },
            },
        ]

        errors = http_request_body_errors(nodes)
        error_ids = [nid for nid, _ in errors]
        assert error_ids == ["raw_empty", "json_empty", "bin_empty"]

    def test_normalize_http_request_bodies_handles_empty_string_data_safely(self):
        from core.workflow.graph_normalizers import normalize_http_request_bodies

        nodes = [
            {
                "id": "raw_empty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "raw-text", "data": ""},
                },
            },
            {
                "id": "json_empty",
                "data": {
                    "type": "http-request",
                    "body": {"type": "json", "data": ""},
                },
            },
        ]
        before = copy.deepcopy(nodes)

        # Should not crash and should leave empty strings alone
        result = normalize_http_request_bodies(nodes)
        assert result == []
        assert nodes == before


def _esq1_303_graph() -> dict:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))


def _if_else(node_id: str, case_ids: tuple[str, ...] = ("true",)) -> dict:
    return {
        "id": node_id,
        "data": {
            "type": "if-else",
            "cases": [{"case_id": c, "logical_operator": "and", "conditions": []} for c in case_ids],
        },
    }


def _legacy_if_else(node_id: str) -> dict:
    # The pre-``cases`` shape: top-level ``logical_operator`` + ``conditions``
    # and no ``cases`` key. graphon's ``IfElseNodeData.iter_cases`` runs it as
    # ONE case whose id is "true" (``if_else_node.py``: ``"true" if
    # uses_legacy_shape``), and the canvas migrates it to case_id "true"
    # (``workflow-init.ts``).
    return {
        "id": node_id,
        "data": {
            "type": "if-else",
            "logical_operator": "and",
            "conditions": [{"variable_selector": ["s", "x"], "comparison_operator": "=", "value": "1"}],
        },
    }


def _edges(source: str, pairs: list[tuple]) -> list[dict]:
    return [{"source": source, "target": target, "sourceHandle": handle} for handle, target in pairs]


def _handles(edges: list[dict]) -> list[tuple]:
    return [(e["target"], e.get("sourceHandle")) for e in edges]


class TestDeclaredBranchHandles:
    def test_if_else_declares_its_case_ids_plus_the_implicit_else(self):
        from core.workflow.graph_normalizers import declared_branch_handles

        assert declared_branch_handles(_if_else("n", ("true",))) == ["true", "false"]
        assert declared_branch_handles(_if_else("n", ("c1", "c2"))) == ["c1", "c2", "false"]

    def test_question_classifier_declares_its_class_ids(self):
        from core.workflow.graph_normalizers import declared_branch_handles

        qc = {"id": "q", "data": {"type": "question-classifier", "classes": [{"id": "1", "name": "A"}, {"id": "2"}]}}
        assert declared_branch_handles(qc) == ["1", "2"]

    def test_human_input_declares_its_action_ids_plus_the_implicit_timeout(self):
        # (i) R1(b): human-input routes an implicit "__timeout" arm
        # (TIMEOUT_HANDLE, core/workflow/nodes/human_input/constants.py) in
        # addition to its declared user actions.
        from core.workflow.graph_normalizers import declared_branch_handles

        hi = {"id": "h", "data": {"type": "human-input", "user_actions": [{"id": "approve"}, {"id": "deny"}]}}
        assert declared_branch_handles(hi) == ["approve", "deny", "__timeout"]

    def test_fail_branch_nodes_declare_source_and_fail_branch(self):
        # R1(a): a fail-branch node's SUCCESS path stays on the handle
        # graphon actually emits (NodeRunResult.edge_source_handle defaults
        # to "source"), not an invented "success" handle nothing emits.
        from core.workflow.graph_normalizers import declared_branch_handles

        node = {"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}
        assert declared_branch_handles(node) == ["source", "fail-branch"]

    def test_if_else_with_fail_branch_declares_cases_false_and_fail_branch(self):
        # (iv) a branch-type node with error_strategy fail-branch appends
        # "fail-branch" to its own declared handles rather than replacing them.
        from core.workflow.graph_normalizers import declared_branch_handles

        node = _if_else("n", ("c1", "c2"))
        node["data"]["error_strategy"] = "fail-branch"
        assert declared_branch_handles(node) == ["c1", "c2", "false", "fail-branch"]

    def test_plain_nodes_declare_nothing(self):
        from core.workflow.graph_normalizers import declared_branch_handles

        assert declared_branch_handles({"id": "l", "data": {"type": "llm"}}) == []

    def test_a_legacy_if_else_without_cases_declares_true_and_false_like_graphon_routes_it(self):
        # graphon routes a node whose ``cases`` is absent or None on "true"
        # (iter_cases' legacy case) or "false"; declaring only "false" made
        # the engine's own "true" arm look undeclared.
        from core.workflow.graph_normalizers import declared_branch_handles

        assert declared_branch_handles(_legacy_if_else("n")) == ["true", "false"]

        explicit_none = _legacy_if_else("n")
        explicit_none["data"]["cases"] = None
        assert declared_branch_handles(explicit_none) == ["true", "false"]

        with_fail_branch = _legacy_if_else("n")
        with_fail_branch["data"]["error_strategy"] = "fail-branch"
        assert declared_branch_handles(with_fail_branch) == ["true", "false", "fail-branch"]

    def test_an_explicitly_empty_cases_list_is_not_the_legacy_shape(self):
        # ``cases: []`` is not None: graphon iterates zero cases and always
        # takes the ELSE arm, so only "false" is declared.
        from core.workflow.graph_normalizers import declared_branch_handles

        assert declared_branch_handles(_if_else("n", ())) == ["false"]


class TestRepairBranchEdgeHandles:
    """The planner names handles before the node builder picks case ids
    (ESQ1-303: ``score_equals_60`` / ``else`` against a case named ``true``).
    Repair only what is forced; leave anything ambiguous for the validator."""

    def test_heals_the_esq1_303_dev_edges_else_alias_pins_the_other_arm(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        graph = _esq1_303_graph()

        unresolved = repair_branch_edge_handles(graph["nodes"], graph["edges"])

        assert unresolved == []
        by_target = {e["target"]: e["sourceHandle"] for e in graph["edges"] if e["source"] == "node2"}
        assert by_target == {"node3": "true", "node4": "false"}

    def test_legacy_default_handle_edges_still_take_unused_handles_in_order(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("source", "a"), (None, "b")])
        assert repair_branch_edge_handles([_if_else("n")], edges) == []
        assert _handles(edges) == [("a", "true"), ("b", "false")]

    def test_three_default_edges_on_two_handles_stay_untouched(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("source", "a"), ("source", "b"), ("source", "c")])
        unresolved = repair_branch_edge_handles([_if_else("n")], edges)
        assert len(unresolved) == 3
        assert all(h == "source" for _, h in _handles(edges))

    def test_both_edges_unknown_with_no_alias_is_ambiguous_and_untouched(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("pass", "a"), ("fail", "b")])
        unresolved = repair_branch_edge_handles([_if_else("n")], edges)
        assert [u["handle"] for u in unresolved] == ["pass", "fail"]
        assert _handles(edges) == [("a", "pass"), ("b", "fail")]

    def test_a_single_unknown_edge_with_two_free_arms_is_ambiguous(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("maybe", "a")])
        assert len(repair_branch_edge_handles([_if_else("n")], edges)) == 1
        assert _handles(edges) == [("a", "maybe")]

    def test_three_case_if_else_with_invented_names_is_ambiguous(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("low", "a"), ("mid", "b"), ("high", "c")])
        assert len(repair_branch_edge_handles([_if_else("n", ("case1", "case2"))], edges)) == 3
        assert _handles(edges) == [("a", "low"), ("b", "mid"), ("c", "high")]

    def test_one_exact_plus_else_alias_forces_the_last_unknown_onto_the_last_free_case(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("case1", "a"), ("whatever", "b"), ("else", "c")])
        assert repair_branch_edge_handles([_if_else("n", ("case1", "case2"))], edges) == []
        assert _handles(edges) == [("a", "case1"), ("b", "case2"), ("c", "false")]

    def test_an_if_alias_while_true_is_taken_is_a_fan_out_not_the_else_arm(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("true", "a"), ("if", "b")])
        repair_branch_edge_handles([_if_else("n")], edges)
        assert _handles(edges) == [("a", "true"), ("b", "true")]

    def test_the_same_unknown_handle_twice_is_one_arm_fanning_out(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("false", "a"), ("matched", "b"), ("matched", "c")])
        assert repair_branch_edge_handles([_if_else("n")], edges) == []
        assert _handles(edges) == [("a", "false"), ("b", "true"), ("c", "true")]

    def test_question_classifier_matches_class_names_case_and_space_insensitively(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [
            {
                "id": "q",
                "data": {
                    "type": "question-classifier",
                    # A third, unwired class: with only 2 classes, a broken
                    # name match on "tech_support" could still "succeed" by
                    # elimination (only one handle would ever be left
                    # unused). With 3, elimination can't mask a failed match.
                    "classes": [
                        {"id": "1", "name": "Billing"},
                        {"id": "2", "name": "Tech Support"},
                        {"id": "3", "name": "Refunds"},
                    ],
                },
            }
        ]
        edges = _edges("q", [("billing", "a"), ("tech_support", "b")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("a", "1"), ("b", "2")]

    def test_human_input_matches_action_stems_then_eliminates(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [
            {
                "id": "h",
                "data": {
                    "type": "human-input",
                    "user_actions": [{"id": "approve", "title": "Approve"}, {"id": "deny", "title": "Deny"}],
                },
            }
        ]
        edges = _edges("h", [("approved", "a"), ("rejected", "b")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("a", "approve"), ("b", "deny")]

    def test_a_short_stem_never_matches_by_prefix(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        # "no" is too short a stem to claim "nothing"; both arms are free, so refuse.
        nodes = [{"id": "h", "data": {"type": "human-input", "user_actions": [{"id": "no"}, {"id": "later"}]}}]
        edges = _edges("h", [("nothing", "a")])
        assert len(repair_branch_edge_handles(nodes, edges)) == 1

    def test_alias_trust_documented_limit_a_mislabelled_else_alias_swaps_the_arms(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        # The planner put an ELSE alias on the IF-arm edge and "true" on the
        # other. Names are trusted as names: this maps "default" -> false. No
        # handle repair can detect a planner/builder semantic inversion; the
        # node-builder handle contract (prompt) is what prevents it.
        edges = _edges("n", [("default", "a"), ("true", "b")])
        repair_branch_edge_handles([_if_else("n")], edges)
        assert _handles(edges) == [("a", "false"), ("b", "true")]

    def test_non_branch_nodes_are_untouched(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = [{"source": "llm1", "target": "end", "sourceHandle": "source"}]
        assert repair_branch_edge_handles([{"id": "llm1", "data": {"type": "llm"}}], edges) == []
        assert edges[0]["sourceHandle"] == "source"

    def test_fail_branch_node_success_on_source_and_failure_on_fail_branch_is_untouched(self):
        # (ii) R1(a): the success edge is already on "source" (what graphon
        # actually emits) and the failure edge on "fail-branch"; both are
        # exact matches, so nothing is re-homed.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [{"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}]
        edges = _edges("h", [("source", "ok"), ("fail-branch", "err")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("ok", "source"), ("err", "fail-branch")]

    def test_human_input_timeout_edge_is_untouched(self):
        # (iii) the implicit "__timeout" arm is a declared handle; an edge
        # already on it is an exact match and is left alone.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [{"id": "h", "data": {"type": "human-input", "user_actions": [{"id": "approve"}, {"id": "deny"}]}}]
        edges = _edges("h", [("approve", "a"), ("deny", "b"), ("__timeout", "c")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("a", "approve"), ("b", "deny"), ("c", "__timeout")]

    def test_a_missing_source_handle_key_on_a_fail_branch_node_means_source_and_is_untouched(self):
        # Review fix round 1, Important 1: graphon resolves a missing/None
        # sourceHandle to "source" (edge_config.get("sourceHandle",
        # "source"), graph/graph.py:131). These are already-valid graphs;
        # they must come out byte-for-byte identical, not re-homed.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = {"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}

        edges = _edges("h", [(None, "a"), (None, "b")])
        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", None), ("b", None)]

        edges = _edges("h", [("source", "a"), (None, "b")])
        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", "source"), ("b", None)]

        edges = _edges("h", [(None, "a"), (None, "b"), ("fail-branch", "e")])
        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", None), ("b", None), ("e", "fail-branch")]

    def test_fail_branch_if_else_fan_out_stays_unresolved_like_before_fail_branch_existed(self):
        # Review fix round 1, Important 2 (probe 1): "fail-branch" must not
        # be a candidate the fan-out rule assigns to -- with true/false both
        # wired, a third, unrecognized name has nowhere safe to land.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("true", "a"), ("false", "b"), ("matched", "c")])

        unresolved = repair_branch_edge_handles([node], edges)

        assert len(unresolved) == 1
        assert unresolved[0]["handle"] == "matched"
        assert _handles(edges) == [("a", "true"), ("b", "false"), ("c", "matched")]

    def test_fail_branch_if_else_three_default_edges_stay_unresolved_like_before_fail_branch_existed(self):
        # Review fix round 1, Important 2 (probe 2): three default-handle
        # edges against true/false only (fail-branch excluded from the
        # pool) is exactly the pre-fail-branch "too many defaults" case.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("source", "a"), ("source", "b"), ("source", "c")])

        unresolved = repair_branch_edge_handles([node], edges)

        assert len(unresolved) == 3
        assert all(h == "source" for _, h in _handles(edges))

    def test_fail_branch_success_alias_maps_to_source_not_elimination(self):
        # Review fix round 1, Important 2 (probe 3): "success" is an
        # explicit alias for a plain fail-branch node's "source" arm, not a
        # guess made by process of elimination.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [{"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}]
        edges = _edges("h", [("source", "ok"), ("success", "b")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("ok", "source"), ("b", "source")]

    def test_fail_branch_unaliased_named_edge_never_lands_on_source_via_elimination(self):
        # Review fix round 1, Important 2: none of the three probes above
        # actually exercises the "skip rule 2 on a plain fail-branch node"
        # guard itself (probes 1-2 fail earlier on "unused != 1"; probe 3 is
        # claimed by an alias before reaching elimination at all). A word
        # not on either alias list must still fail closed rather than land
        # on the one handle ("source") that rule 2 would otherwise see as
        # the sole unused slot.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [{"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}]
        edges = _edges("h", [("problem", "b")])

        unresolved = repair_branch_edge_handles(nodes, edges)

        assert len(unresolved) == 1
        assert _handles(edges) == [("b", "problem")]

    def test_human_input_timeout_alias_is_claimed_before_elimination(self):
        # Review fix round 1, Important 3: "timeout" must resolve via the
        # explicit alias (rule 1), not fan out onto the unwired "deny" arm
        # by elimination (rule 2).
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [{"id": "h", "data": {"type": "human-input", "user_actions": [{"id": "approve"}, {"id": "deny"}]}}]
        edges = _edges("h", [("approve", "a"), ("timeout", "t")])
        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("a", "approve"), ("t", "__timeout")]

    def test_duplicate_canonical_class_names_fail_closed_instead_of_picking_a_winner(self):
        # Review fix round 1, Minor 1a: "Support" and "support" both canon
        # to "support" -- that name must not silently pick class "1" or "2".
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        nodes = [
            {
                "id": "q",
                "data": {
                    "type": "question-classifier",
                    "classes": [{"id": "1", "name": "Support"}, {"id": "2", "name": "support"}],
                },
            }
        ]
        edges = _edges("q", [("support", "a")])

        unresolved = repair_branch_edge_handles(nodes, edges)

        assert len(unresolved) == 1
        assert _handles(edges) == [("a", "support")]

    def test_an_alias_that_disagrees_with_a_stem_match_fails_closed(self):
        # Review fix round 1, Minor 1b: "default" is the ELSE alias, but it
        # is also the unambiguous stem of a case literally named
        # "default_case" -- the two signals disagree, so neither wins.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("default_case", "other"))
        edges = _edges("n", [("default", "a")])

        unresolved = repair_branch_edge_handles([node], edges)

        assert len(unresolved) == 1
        assert _handles(edges) == [("a", "default")]

    def test_if_alias_needs_exactly_one_case_not_exactly_two_handles(self):
        # Review fix round 1, Minor 2: zero cases + fail-branch also has 2
        # declared handles (["false", "fail-branch"]) -- the same count as
        # "one case + ELSE" -- but there is no IF arm to alias "yes" onto.
        # "false" is already taken by another edge, so elimination (which
        # would otherwise also land "yes" on the sole leftover handle) can't
        # mask a wrongly-firing IF alias either: this isolates the alias fix.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ())
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("false", "z"), ("yes", "a")])

        unresolved = repair_branch_edge_handles([node], edges)

        assert len(unresolved) == 1
        assert unresolved[0]["handle"] == "yes"
        assert _handles(edges) == [("z", "false"), ("a", "yes")]

    def test_one_case_if_else_keeps_its_if_alias_even_with_fail_branch(self):
        # Review fix round 1, Minor 2: one case + fail-branch has 3 declared
        # handles (["true", "false", "fail-branch"]); the IF alias must
        # still resolve since there is still exactly one case.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("yes", "a")])
        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", "true")]

    def test_a_legacy_if_else_wired_true_and_false_is_untouched_and_fully_declared(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles, undeclared_branch_handles

        nodes = [_legacy_if_else("n")]
        edges = _edges("n", [("true", "a"), ("false", "b")])

        assert repair_branch_edge_handles(nodes, edges) == []
        assert _handles(edges) == [("a", "true"), ("b", "false")]
        assert undeclared_branch_handles(nodes, edges) == []

    def test_a_legacy_if_else_with_only_its_true_arm_wired_keeps_it_on_true(self):
        # Before: "true" looked undeclared, the one unused declared handle was
        # "false", and the fan-out rule re-homed the IF arm onto ELSE.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("true", "a")])

        assert repair_branch_edge_handles([_legacy_if_else("n")], edges) == []
        assert _handles(edges) == [("a", "true")]

    def test_a_legacy_if_else_counts_as_one_case_for_the_if_alias(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        edges = _edges("n", [("yes", "a")])
        assert repair_branch_edge_handles([_legacy_if_else("n")], edges) == []
        assert _handles(edges) == [("a", "true")]  # not eliminated onto the unused "false"

        edges = _edges("n", [("yes", "a"), ("else", "b")])
        assert repair_branch_edge_handles([_legacy_if_else("n")], edges) == []
        assert _handles(edges) == [("a", "true"), ("b", "false")]

    def test_failure_arm_aliases_reach_fail_branch_however_they_are_spelled(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = {"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}
        for name in ("fail_branch", "failbranch", "Fail Branch", "error_branch", "Error-Branch", "on_fail", "fallback"):
            edges = _edges("h", [("source", "ok"), (name, "err")])
            assert repair_branch_edge_handles([node], edges) == [], name
            assert _handles(edges) == [("ok", "source"), ("err", "fail-branch")], name

    def test_a_branch_type_fail_branch_node_resolves_a_failure_alias_to_fail_branch_not_else(self):
        # Before: "fallback" was no alias, so with "true" wired the fan-out
        # rule eliminated it onto the one unused arm it counts -- ELSE.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("true", "a"), ("fallback", "b")])

        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", "true"), ("b", "fail-branch")]

    def test_an_unknown_name_on_a_branch_type_node_with_an_unwired_fail_branch_is_not_eliminated(self):
        # With the fail-branch arm unwired, an unrecognized name is as likely
        # to be the failure arm as the one free branch arm: fail closed.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("true", "a"), ("whatever", "b")])

        unresolved = repair_branch_edge_handles([node], edges)

        assert [u["handle"] for u in unresolved] == ["whatever"]
        assert _handles(edges) == [("a", "true"), ("b", "whatever")]

    def test_a_branch_type_node_with_its_fail_branch_wired_still_eliminates(self):
        # Once the fail-branch arm is wired it is on the same footing as the
        # IF arm, and the pre-existing rule applies: the one unwired branch
        # arm (ELSE) is the forced home of the unknown name.
        from core.workflow.graph_normalizers import repair_branch_edge_handles

        node = _if_else("n", ("true",))
        node["data"]["error_strategy"] = "fail-branch"
        edges = _edges("n", [("true", "a"), ("fail-branch", "e"), ("whatever", "b")])

        assert repair_branch_edge_handles([node], edges) == []
        assert _handles(edges) == [("a", "true"), ("e", "fail-branch"), ("b", "false")]


class TestUndeclaredBranchHandles:
    def test_reports_every_edge_whose_handle_the_node_does_not_declare(self):
        from core.workflow.graph_normalizers import undeclared_branch_handles

        graph = _esq1_303_graph()  # before repair: score_equals_60 / else
        bad = undeclared_branch_handles(graph["nodes"], graph["edges"])

        assert [(b["node_id"], b["handle"], b["target"]) for b in bad] == [
            ("node2", "score_equals_60", "node3"),
            ("node2", "else", "node4"),
        ]
        assert bad[0]["declared"] == ["true", "false"]

    def test_default_handles_on_branch_nodes_are_undeclared_too(self):
        from core.workflow.graph_normalizers import undeclared_branch_handles

        edges = [{"source": "n", "target": "a"}, {"source": "n", "target": "b", "sourceHandle": "source"}]
        assert [b["handle"] for b in undeclared_branch_handles([_if_else("n")], edges)] == ["source", "source"]

    def test_a_clean_graph_reports_nothing(self):
        from core.workflow.graph_normalizers import repair_branch_edge_handles, undeclared_branch_handles

        graph = _esq1_303_graph()
        repair_branch_edge_handles(graph["nodes"], graph["edges"])
        assert undeclared_branch_handles(graph["nodes"], graph["edges"]) == []

    def test_fail_branch_node_clean_edges_report_nothing(self):
        # (ii) source + fail-branch is exactly the declared set; nothing to report.
        from core.workflow.graph_normalizers import undeclared_branch_handles

        nodes = [{"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}]
        edges = _edges("h", [("source", "ok"), ("fail-branch", "err")])
        assert undeclared_branch_handles(nodes, edges) == []

    def test_human_input_timeout_edge_is_not_reported(self):
        # (iii) "__timeout" is declared, so it is not flagged as undeclared.
        from core.workflow.graph_normalizers import undeclared_branch_handles

        nodes = [{"id": "h", "data": {"type": "human-input", "user_actions": [{"id": "approve"}, {"id": "deny"}]}}]
        edges = _edges("h", [("approve", "a"), ("deny", "b"), ("__timeout", "c")])
        assert undeclared_branch_handles(nodes, edges) == []

    def test_a_missing_source_handle_key_on_a_fail_branch_node_reports_nothing(self):
        # Review fix round 1, Important 1: a missing/None sourceHandle means
        # "source" to graphon; it must not be reported as an undeclared
        # handle when "source" itself is declared (a fail-branch node).
        from core.workflow.graph_normalizers import undeclared_branch_handles

        node = {"id": "h", "data": {"type": "http-request", "error_strategy": "fail-branch"}}

        assert undeclared_branch_handles([node], _edges("h", [(None, "a"), (None, "b")])) == []
        assert undeclared_branch_handles([node], _edges("h", [("source", "a"), (None, "b")])) == []
        assert undeclared_branch_handles([node], _edges("h", [(None, "a"), (None, "b"), ("fail-branch", "e")])) == []


class TestNormalizeParameterExtractorQueries:
    """graphon's ``ParameterExtractorNodeData.query`` is ``list[str]`` -- ONE
    selector (``nodes/parameter_extractor/entities.py:112``). The generator's
    node-builder prompt for this node type instead shows an array of selector
    arrays (Blocker A), which ``Graph.init`` always refuses, so a node written
    that way never starts. This is the deterministic unwrap for the one
    unambiguous case; the prompt itself is fixed separately."""

    def test_unwraps_a_single_nested_selector(self):
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": [["node2", "text"]]}}

        assert normalize_parameter_extractor_queries([node]) == ["node3"]
        assert node["data"]["query"] == ["node2", "text"]

    def test_an_already_flat_query_is_left_alone(self):
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": ["node2", "text"]}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == ["node2", "text"]

    def test_an_empty_query_is_left_alone(self):
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": []}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == []

    def test_more_than_one_inner_selector_is_ambiguous_and_left_for_the_validator(self):
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": [["a", "b"], ["c", "d"]]}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == [["a", "b"], ["c", "d"]]

    def test_a_non_parameter_extractor_node_is_untouched(self):
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "llm", "query": [["node2", "text"]]}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == [["node2", "text"]]

    def test_an_empty_inner_selector_is_left_for_the_engine_to_refuse(self):
        # ``[[]]`` -> ``[]`` would PASS ``ParameterExtractorNodeData`` (a
        # ``list[str]`` of length 0 is a valid list[str]) and then resolve to
        # ``None`` at run time: ``VariablePool.get`` returns None for any
        # selector shorter than 2 (``runtime/variable_pool.py:211``). The
        # normalizer only turns a graph the engine REFUSES into one it ACCEPTS,
        # so it must not trade a loud ``Graph.init`` refusal for a silent
        # run-time break.
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": [[]]}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == [[]]

    def test_a_one_segment_inner_selector_is_left_for_the_engine_to_refuse(self):
        # Same reason as the empty inner selector: ``["node2"]`` is a valid
        # ``list[str]`` but ``VariablePool.get`` never resolves it.
        from core.workflow.graph_normalizers import normalize_parameter_extractor_queries

        node = {"id": "node3", "data": {"type": "parameter-extractor", "query": [["node2"]]}}

        assert normalize_parameter_extractor_queries([node]) == []
        assert node["data"]["query"] == [["node2"]]

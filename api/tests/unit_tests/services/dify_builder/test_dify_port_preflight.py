"""``apply_repair`` dry-validates the graph it is about to write. Separate from
``test_dify_port.py`` because that module's older ``apply_repair`` tests build
nodes from bare ``config={}`` stand-ins (not valid node data) and bypass the
check; these tests use real node data and the real check."""

import json
from unittest.mock import MagicMock, patch

import pytest

from core.dify_builder.models import MutationIntent
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import PreflightError
from services.dify_builder.revision import execution_revision
from tests.unit_tests.services.dify_builder.test_dify_port import _actor, _configure_session_get, _workflow

_START = {"id": "node1", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}}
# ``comparison_operator`` must be one of graphon's SupportedComparisonOperator
# literals; "equals" is not, and no normalizer heals it -- it reaches the
# preflight as written. (A numeric ``value`` would be coerced first, see
# test_apply_repair_coerces_a_numeric_condition_value_before_the_preflight.)
_BROKEN_IF_ELSE_CONFIG = {
    "title": "判断分数",
    "logical_operator": "and",
    "cases": [
        {
            "case_id": "true",
            "logical_operator": "and",
            "conditions": [
                {"id": "c1", "variable_selector": ["node1", "score"], "comparison_operator": "equals", "value": "60"}
            ],
        }
    ],
}


@pytest.fixture
def mock_session() -> MagicMock:
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    return session


@pytest.fixture(autouse=True)
def _mock_db():
    with patch("services.dify_builder.dify_port.db"), patch("services.dify_builder.dify_port.set_login_user"):
        yield


@pytest.fixture(autouse=True)
def _mock_sessionmaker(mock_session: MagicMock):
    with patch("services.dify_builder.dify_port.sessionmaker") as ctor:
        ctor.return_value = MagicMock(return_value=mock_session)
        yield ctor


def _apply(mock_session: MagicMock, graph_dict: dict, intents: list[MutationIntent]):
    _configure_session_get(mock_session, account=MagicMock(id="acc-1"), app=MagicMock(id="app-1", tenant_id="tenant-1"))
    workflow = _workflow(graph_dict=graph_dict, features_dict={})
    with patch("services.dify_builder.dify_port.WorkflowService") as mock_ws_cls:
        mock_ws_cls.return_value.get_draft_workflow.return_value = workflow
        mock_ws_cls.return_value.sync_draft_workflow.return_value = _workflow(graph_dict=graph_dict)
        result = WorkflowServiceDifyPort().apply_repair(
            "app-1", _actor(), intents, expected_revision=execution_revision(workflow)
        )
    return result, mock_ws_cls.return_value.sync_draft_workflow


def test_a_repair_that_would_not_start_is_rejected_before_it_is_written(mock_session: MagicMock):
    intents = [
        MutationIntent(
            op="create_node", args={"node_type": "if-else", "node_id": "node2", "config": _BROKEN_IF_ELSE_CONFIG}
        )
    ]

    with pytest.raises(PreflightError, match=r"node 'node2' \(if-else\)") as excinfo:
        _apply(mock_session, {"nodes": [_START], "edges": []}, intents)

    assert "comparison_operator" in str(excinfo.value)
    assert isinstance(excinfo.value, ValueError)  # the handlers' existing ``except ValueError`` catches it


def test_a_preflight_rejection_is_the_core_draft_would_not_start_error():
    """The handlers live in ``core`` and cannot import ``services``, so they
    tell "this draft would not start" apart from a stale intent by the core
    type this one subclasses."""
    from core.dify_builder.errors import DraftWouldNotStartError

    assert issubclass(PreflightError, DraftWouldNotStartError)
    assert issubclass(PreflightError, ValueError)


def test_a_pre_existing_broken_node_the_repair_does_not_touch_does_not_veto_it(mock_session: MagicMock):
    broken = {"id": "node2", "type": "custom", "data": {"type": "if-else", **_BROKEN_IF_ELSE_CONFIG}}
    fix_elsewhere = [MutationIntent(op="set_node_config", args={"node_id": "node1", "path": "title", "value": "Begin"})]

    result, sync = _apply(mock_session, {"nodes": [_START, broken], "edges": []}, fix_elsewhere)

    assert result.changed_nodes == ["node1"]
    sync.assert_called_once()


def test_a_repair_that_heals_the_broken_node_is_written(mock_session: MagicMock):
    broken = {"id": "node2", "type": "custom", "data": {"type": "if-else", **_BROKEN_IF_ELSE_CONFIG}}
    healed_cases = json.loads(json.dumps(_BROKEN_IF_ELSE_CONFIG["cases"]))
    healed_cases[0]["conditions"][0]["comparison_operator"] = "="
    heal = [MutationIntent(op="set_node_config", args={"node_id": "node2", "path": "cases", "value": healed_cases})]

    result, sync = _apply(mock_session, {"nodes": [_START, broken], "edges": []}, heal)

    assert result.changed_nodes == ["node2"]
    _, kwargs = sync.call_args
    assert kwargs["graph"]["nodes"][1]["data"]["cases"][0]["conditions"][0]["comparison_operator"] == "="


def test_apply_repair_coerces_a_numeric_condition_value_before_the_preflight(mock_session: MagicMock):
    """The ESQ1-285 flip-flop: a Fix/Edit repair writes ``"value": 60`` (the
    generator never produced this intent, so the shared postprocess never saw
    it). The chokepoint normalizes it, and the preflight then passes."""
    numeric_cases = [
        {
            "case_id": "true",
            "logical_operator": "and",
            "conditions": [
                {"id": "c1", "variable_selector": ["node1", "score"], "comparison_operator": "=", "value": 60}
            ],
        }
    ]
    valid_cases = json.loads(json.dumps(numeric_cases))
    valid_cases[0]["conditions"][0]["value"] = "1"  # the draft is currently valid
    node2 = {"id": "node2", "type": "custom", "data": {"type": "if-else", "title": "判断分数", "cases": valid_cases}}
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node2", "path": "cases", "value": numeric_cases})]

    result, sync = _apply(mock_session, {"nodes": [_START, node2], "edges": []}, intents)

    assert result.changed_nodes == ["node2"]
    _, kwargs = sync.call_args
    assert kwargs["graph"]["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] == "60"


def test_apply_repair_fills_http_body_item_types_before_the_preflight(mock_session: MagicMock):
    body = {"type": "json", "data": [{"key": "", "value": '{"a": 1}'}]}  # one item, no ``type``
    http = {
        "id": "node4",
        "type": "custom",
        "data": {
            "type": "http-request",
            "title": "Call",
            "method": "post",
            "url": "https://x.test/a",
            "authorization": {"config": None, "type": "no-auth"},
            "headers": "",
            "params": "",
            "body": {"type": "none", "data": []},
        },
    }
    intents = [MutationIntent(op="set_node_config", args={"node_id": "node4", "path": "body", "value": body})]

    result, sync = _apply(mock_session, {"nodes": [_START, http], "edges": []}, intents)

    assert result.changed_nodes == ["node4"]
    _, kwargs = sync.call_args
    assert kwargs["graph"]["nodes"][1]["data"]["body"]["data"][0]["type"] == "text"


def test_apply_repair_counts_a_node_the_chokepoint_normalizer_heals_as_changed(mock_session: MagicMock):
    """The chokepoint normalizers scan every node in the graph, not just the
    ones an intent named: a repair that only touches node1's title can still
    heal an UNTOUCHED node's numeric condition value as a side effect.
    ``diff_graphs`` already reports that node as changed -- ``changed_nodes``
    must agree, or the ApplyResult is internally inconsistent."""
    numeric_cases = [
        {
            "case_id": "true",
            "logical_operator": "and",
            "conditions": [
                {"id": "c1", "variable_selector": ["node1", "score"], "comparison_operator": "=", "value": 60}
            ],
        }
    ]
    untouched = {
        "id": "node2",
        "type": "custom",
        "data": {"type": "if-else", "title": "判断分数", "cases": numeric_cases},
    }
    fix_elsewhere = [MutationIntent(op="set_node_config", args={"node_id": "node1", "path": "title", "value": "Begin"})]

    result, sync = _apply(mock_session, {"nodes": [_START, untouched], "edges": []}, fix_elsewhere)

    assert set(result.changed_nodes) == {"node1", "node2"}
    _, kwargs = sync.call_args
    assert kwargs["graph"]["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] == "60"


def _http_create_intent(node_id: str, authorization: dict) -> MutationIntent:
    config = {
        "title": "Call",
        "method": "post",
        "url": "https://x.test/a",
        "authorization": authorization,
        "headers": "",
        "params": "",
        "body": {"type": "none", "data": []},
    }
    return MutationIntent(op="create_node", args={"node_type": "http-request", "node_id": node_id, "config": config})


def test_apply_repair_heals_an_authorization_without_type_and_writes(mock_session: MagicMock):
    """The live E2E crash: this shape made the preflight raise KeyError out of
    ``apply_repair`` and failed the Build session. The chokepoint normalizer
    now fills the type, so the repair is written."""
    intents = [_http_create_intent("node5", {"config": {"type": "bearer", "api_key": "{{#node1.key#}}"}})]

    result, sync = _apply(mock_session, {"nodes": [_START], "edges": []}, intents)

    assert "node5" in result.changed_nodes
    _, kwargs = sync.call_args
    written = next(n for n in kwargs["graph"]["nodes"] if n["id"] == "node5")
    assert written["data"]["authorization"]["type"] == "api-key"


def test_apply_repair_rejects_a_crashing_node_it_cannot_heal_instead_of_raising_it(mock_session: MagicMock):
    """A shape no normalizer heals (a present but invalid ``type`` also makes
    graphon raise KeyError) is a preflight PROBLEM -- a PreflightError the
    handlers already catch -- never a KeyError that ends the session."""
    intents = [_http_create_intent("node5", {"type": "bearer", "config": {"type": "bearer", "api_key": "x"}})]

    with pytest.raises(PreflightError, match=r"node 'node5' \(http-request\): KeyError"):
        _apply(mock_session, {"nodes": [_START], "edges": []}, intents)

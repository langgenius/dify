from copy import deepcopy

import pytest

from core.dify_builder.models import NodeOutput, Run
from services.dify_builder.credentials import REDACTED
from services.dify_builder.diagnostic_context import redact_run_context


@pytest.mark.parametrize("field", ["api_key", "apiKey", "X-Api-Key", "access_token", "client_secret", "password"])
def test_nested_sensitive_fields_are_redacted_without_hiding_ordinary_key(field):
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
def test_graph_credentials_repeated_in_run_and_output_text_are_removed(field, value):
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


def test_authorization_scheme_is_removed_when_only_the_token_repeats_in_error():
    graph = {"nodes": [{"data": {"headers": "Authorization: Bearer auth-private"}}]}

    safe_run, _ = redact_run_context(Run(error="connection refused: auth-private"), graph, [])

    assert safe_run.error == f"connection refused: {REDACTED}"


def test_falsey_diagnostic_values_are_preserved_in_independent_copies():
    output = NodeOutput(inputs={"empty": "", "null": None, "zero": 0, "false": False, "list": [], "dict": {}})

    safe_run, safe_outputs = redact_run_context(Run(per_node=[output]), {}, [output])

    assert safe_outputs[0] == output
    assert safe_outputs[0] is not output
    assert safe_run.per_node[0] is not output


def test_overlapping_credentials_do_not_leave_a_suffix_in_free_text():
    graph = {"nodes": [{"data": {"api_key": "private", "password": "private-long"}}]}

    safe_run, _ = redact_run_context(Run(error="private-long refused private"), graph, [])

    assert safe_run.error == f"{REDACTED} refused {REDACTED}"


def test_short_graph_credential_does_not_corrupt_an_inserted_sentinel():
    graph = {"nodes": [{"data": {"api_key": "private-long", "password": "DIFY"}}]}

    safe_run, _ = redact_run_context(Run(error="private-long refused DIFY"), graph, [])

    assert safe_run.error == f"{REDACTED} refused {REDACTED}"


def test_structured_redaction_preserves_exact_sentinels_when_a_credential_matches_part_of_them():
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

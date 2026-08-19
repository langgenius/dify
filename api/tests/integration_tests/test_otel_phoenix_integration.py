"""Integration test: UnifiedOTelAdapter exports traces to a real Phoenix OTLP endpoint.

Runs against a locally running Phoenix container (e.g. the dify-phoenix-dev compose stack,
Phoenix UI/OTLP-HTTP on http://localhost:6006). Skips automatically when Phoenix is not
reachable, so CI without the container is unaffected.

Environment overrides:
- DIFY_OTEL_IT_PHOENIX_ENDPOINT (default http://localhost:6006)
- DIFY_OTEL_IT_PHOENIX_ADMIN_SECRET (required only when Phoenix auth is enabled)
"""

import json
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any
from urllib.request import Request, urlopen

import pytest

from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.otel import OTelTracingConfig, UnifiedOTelAdapter

PHOENIX_ENDPOINT = os.environ.get("DIFY_OTEL_IT_PHOENIX_ENDPOINT", "http://localhost:6006")
PHOENIX_ADMIN_SECRET = os.environ.get("DIFY_OTEL_IT_PHOENIX_ADMIN_SECRET", "")
INGEST_URL = f"{PHOENIX_ENDPOINT}/v1/traces"
GRAPHQL_URL = f"{PHOENIX_ENDPOINT}/graphql"


def _graphql(query: str, variables: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(GRAPHQL_URL, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def _phoenix_reachable() -> bool:
    try:
        _graphql("{ projects { edges { node { name } } } }", token=PHOENIX_ADMIN_SECRET or None)
        return True
    except Exception:
        return False


def _create_api_key() -> str:
    result = _graphql(
        'mutation { createUserApiKey(input: {name: "otel-it"}) { jwt } }',
        token=PHOENIX_ADMIN_SECRET,
    )
    return result["data"]["createUserApiKey"]["jwt"]


def _project_id_for_default_project(token: str) -> str:
    result = _graphql("{ projects(first: 20) { edges { node { id name } } } }", token=token)
    for edge in result["data"]["projects"]["edges"]:
        if edge["node"]["name"] == "default":
            return edge["node"]["id"]
    raise AssertionError("default project not found in Phoenix")


def _span_names(project_id: str, span_name: str, token: str) -> list[str]:
    result = _graphql(
        """
        query($id: ID!, $f: String) {
            node(id: $id) {
                ... on Project {
                    spans(first: 10, filterCondition: $f) { edges { node { name } } }
                }
            }
        }
        """,
        {"id": project_id, "f": f"name == '{span_name}'"},
        token=token,
    )
    return [edge["node"]["name"] for edge in result["data"]["node"]["spans"]["edges"]]


def _make_trace(run_id: str) -> CanonicalTrace:
    start = datetime.now().astimezone()
    return CanonicalTrace(
        trace_id=f"it-{run_id}",
        session_id=f"session-{run_id}",
        root_span_id="root-1",
        spans=(
            CanonicalSpan(
                id="root-1",
                parent_id=None,
                name=f"chatflow_it-{run_id}",
                kind=CanonicalSpanKind.CHAIN,
                start_time=start,
                end_time=start + timedelta(seconds=1),
                status=CanonicalSpanStatus.OK,
                can_parent_workflow=True,
            ),
            CanonicalSpan(
                id="llm-1",
                parent_id="root-1",
                name=f"llm-it-{run_id}",
                kind=CanonicalSpanKind.LLM,
                start_time=start,
                end_time=start + timedelta(seconds=1),
                status=CanonicalSpanStatus.ERROR,
                error="integration-test failure marker",
            ),
        ),
    )


@pytest.mark.skipif(not _phoenix_reachable(), reason=f"Phoenix not reachable at {PHOENIX_ENDPOINT}")
def test_otel_adapter_exports_to_phoenix_collector() -> None:
    """Emit a canonical trace through UnifiedOTelAdapter and find the spans in Phoenix."""
    api_key = _create_api_key() if PHOENIX_ADMIN_SECRET else ""
    headers = {"api_key": api_key, "authorization": f"Bearer {api_key}"} if api_key else {}

    config = OTelTracingConfig(
        endpoint=INGEST_URL,
        headers=json.dumps(headers),
        service_name="dify-otel-it",
        resource_attributes={"deployment.environment": "it-test"},
    )
    adapter = UnifiedOTelAdapter(config)

    run_id = uuid.uuid4().hex[:8]
    published: list[tuple[str, str]] = []
    adapter.emit(_make_trace(run_id), None, lambda span_id, ctx: published.append((span_id, ctx.provider)))

    # Export returned SUCCESS (emit did not raise); Phoenix ingests asynchronously — poll.
    token = api_key or PHOENIX_ADMIN_SECRET
    project_id = _project_id_for_default_project(token)
    root_span = f"chatflow_it-{run_id}"
    llm_span = f"llm-it-{run_id}"

    found_root: list[str] = []
    for _ in range(20):
        found_root = _span_names(project_id, root_span, token)
        if found_root:
            break
        time.sleep(0.5)

    assert found_root == [root_span], f"root span {root_span} not found in Phoenix"
    assert _span_names(project_id, llm_span, token) == [llm_span], f"child span {llm_span} not found in Phoenix"
    # export-before-publish ordering: the root span publishes its provider context on success
    assert published, "expected the root span to publish its provider context"
    assert published[0][1] == "otel"

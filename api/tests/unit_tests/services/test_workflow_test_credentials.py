from copy import deepcopy
from typing import Literal

import pytest

from services.workflow_test_credentials import TestCredentialCheck as CredentialCheck
from services.workflow_test_credentials import TestCredentialError as CredentialError
from services.workflow_test_credentials import TestCredentialNotReadyError as NotReady
from services.workflow_test_credentials import TestCredentialStatus as CredentialStatus
from services.workflow_test_credentials import TestCredentialUnavailableError as Unavailable
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


def test_independent_nodes_and_reuse_keep_explicit_selections() -> None:
    graph = {
        "nodes": [
            tool_node("a", "first"),
            tool_node("b", "second"),
            tool_node("c", None, credential_source="reuse_node", reuse_node_id="a", end_user_auth=None),
        ]
    }
    original = deepcopy(graph)
    harness = BuilderCredentialHarness(graph)
    assert harness.service.require_ready(SCOPE, graph=graph, node_id=None) is None
    assert harness.calls == ["first", "second"]
    assert graph == original


def test_single_node_ignores_unconfigured_unrelated_node() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a"), tool_node("b", None)]})
    assert harness.service.require_ready(SCOPE, graph=harness.graph, node_id="a") is None
    with pytest.raises(NotReady):
        harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None)


@pytest.mark.parametrize(
    ("status", "reason", "expected"),
    [
        ("valid", None, "connected"),
        ("unsupported", None, "connected"),
        ("temporarily_unavailable", "provider_timeout", "temporarily_unavailable"),
        ("invalid", "credential_invalid", "invalid"),
        ("invalid", "credential_expired", "reconnect_required"),
    ],
)
def test_readiness_preserves_provider_outcomes(
    status: Literal["valid", "invalid", "temporarily_unavailable", "unsupported"],
    reason: str | None,
    expected: str,
) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.check = CredentialCheck(status=status, reason_code=reason, retryable=status == "temporarily_unavailable")
    if expected == "connected":
        assert harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None) is None
    else:
        with pytest.raises(NotReady) as raised:
            harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None)
        result = raised.value.result
        assert result.credentials[0].status == expected
        assert not result.ready
        assert "secret" not in result.model_dump_json()
        assert "access_token" not in result.model_dump_json()
        with pytest.raises(Unavailable):
            harness.service.resolve(SCOPE, graph=harness.graph, node_id="a")


@pytest.mark.parametrize("status", ["disconnected", "incompatible", "temporarily_unavailable"])
def test_admission_rechecks_credentials_on_every_run(status: CredentialStatus) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    assert harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None) is None
    harness.failure = Unavailable(status)
    with pytest.raises(NotReady) as raised:
        harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None)
    state = raised.value.result.credentials[0]
    assert state.status == status
    if status == "disconnected":
        assert state.credential_id is None


def test_runtime_cannot_resolve_after_membership_or_app_disappears() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.available = False
    with pytest.raises(CredentialError):
        harness.service.resolve(SCOPE, graph=harness.graph, node_id="a")
    assert not harness.calls


def test_legacy_graph_needs_no_test_contract() -> None:
    harness = BuilderCredentialHarness({"nodes": []})
    assert harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None) is None
    assert not harness.calls


def test_resolution_returns_process_local_secret_without_exposing_it_in_repr() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    result = harness.service.resolve(SCOPE, graph=harness.graph, node_id="a")
    assert result.credentials == {"access_token": "secret"}
    assert "secret" not in repr(result)


def test_full_preflight_reports_every_root_without_rewriting_saved_selections() -> None:
    graph = {
        "nodes": [
            tool_node("a", "first"),
            tool_node("b", None),
            tool_node("c", None, credential_source="reuse_node", reuse_node_id="a", end_user_auth=None),
        ]
    }
    original = deepcopy(graph)
    harness = BuilderCredentialHarness(graph)
    result = harness.service.preflight(SCOPE)
    assert not result.ready
    assert [item.node_id for item in result.credentials] == ["a", "b"]
    assert result.credentials[0].node_ids == ("a", "c")
    assert result.credentials[1].status == "disconnected"
    assert harness.calls == ["first"]
    assert graph == original
    assert "secret" not in result.model_dump_json()
    assert "draft_hash" not in result.model_dump()


def test_full_preflight_reads_the_current_draft_on_each_call() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a", "first")]})
    assert harness.service.preflight(SCOPE).ready
    harness.graph = {"nodes": [tool_node("replacement", None)]}
    result = harness.service.preflight(SCOPE)
    assert not result.ready
    assert result.credentials[0].node_id == "replacement"
    assert harness.calls == ["first"]


def test_full_preflight_requires_access_and_a_saved_draft() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.available = False
    with pytest.raises(CredentialError, match="cannot run"):
        harness.service.preflight(SCOPE)
    harness.available = True
    harness.draft_available = False
    with pytest.raises(CredentialError, match="draft not found"):
        harness.service.preflight(SCOPE)
    assert not harness.calls


def test_full_preflight_is_ready_without_end_user_requirements() -> None:
    harness = BuilderCredentialHarness({"nodes": []})
    result = harness.service.preflight(SCOPE)
    assert result.ready
    assert result.credentials == ()
    assert not harness.calls

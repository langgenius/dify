from copy import deepcopy
from typing import Literal

import pytest

from services.workflow_test_credentials import (
    TestCredentialCheck as CredentialCheck,
)
from services.workflow_test_credentials import (
    TestCredentialDraftChangedError as DraftChanged,
)
from services.workflow_test_credentials import (
    TestCredentialError as CredentialError,
)
from services.workflow_test_credentials import (
    TestCredentialNotReadyError as NotReady,
)
from services.workflow_test_credentials import TestCredentialStatus as CredentialStatus
from services.workflow_test_credentials import (
    TestCredentialUnavailableError as Unavailable,
)
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
    result = harness.service.require_ready(SCOPE, draft_hash="saved-hash", node_id=None)
    assert result.ready
    assert harness.calls == ["first", "second"]
    assert result.credentials[0].node_ids == ("a", "c")
    assert graph == original
    assert "secret" not in result.model_dump_json()
    assert "access_token" not in result.model_dump_json()


def test_single_node_ignores_unconfigured_unrelated_node() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a"), tool_node("b", None)]})
    assert harness.service.require_ready(SCOPE, draft_hash="saved-hash", node_id="a").ready
    with pytest.raises(NotReady):
        harness.service.require_ready(SCOPE, draft_hash="saved-hash", node_id=None)


@pytest.mark.parametrize("draft_hash", [None, "old-hash"])
def test_stale_draft_rejected_before_resolving_credentials(draft_hash: str | None) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    with pytest.raises(DraftChanged):
        harness.service.check(SCOPE, draft_hash=draft_hash, node_id=None)
    assert harness.calls == []


def test_draft_change_during_provider_check_rejected() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.change_draft = True
    with pytest.raises(DraftChanged):
        harness.service.check(SCOPE, draft_hash="saved-hash", node_id=None)


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
    status: Literal["valid", "invalid", "temporarily_unavailable", "unsupported"], reason: str | None, expected: str
) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.check = CredentialCheck(status=status, reason_code=reason, retryable=status == "temporarily_unavailable")
    result = harness.service.check(SCOPE, draft_hash="saved-hash", node_id=None)
    assert result.credentials[0].status == expected
    assert result.ready == (expected == "connected")
    if not result.ready:
        with pytest.raises(Unavailable):
            harness.service.resolve(SCOPE, graph=harness.draft.graph, node_id="a")


@pytest.mark.parametrize("status", ["disconnected", "incompatible", "temporarily_unavailable"])
def test_admission_rechecks_after_successful_preflight(status: CredentialStatus) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    assert harness.service.check(SCOPE, draft_hash="saved-hash", node_id=None).ready
    harness.failure = Unavailable(status)
    with pytest.raises(NotReady) as raised:
        harness.service.require_ready(SCOPE, draft_hash="saved-hash", node_id=None)
    state = raised.value.result.credentials[0]
    assert state.status == status
    if status == "disconnected":
        assert state.credential_id is None


def test_runtime_cannot_resolve_after_membership_or_app_disappears() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    harness.available = False
    with pytest.raises(CredentialError):
        harness.service.resolve(SCOPE, graph=harness.draft.graph, node_id="a")
    assert not harness.calls


def test_legacy_graph_needs_no_test_contract() -> None:
    harness = BuilderCredentialHarness({"nodes": []})
    assert harness.service.require_ready(SCOPE, draft_hash=None, node_id=None).ready
    assert not harness.calls


def test_resolution_returns_process_local_secret_without_exposing_it_in_repr() -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
    result = harness.service.resolve(SCOPE, graph=harness.draft.graph, node_id="a")
    assert result.credentials == {"access_token": "secret"}
    assert "secret" not in repr(result)

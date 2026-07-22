from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from pydantic import ValidationError

from core.helper import ssrf_proxy
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionPhase,
    KnowledgeFSDifyIntegrationActivationRequest,
    KnowledgeFSDifyIntegrationFreezeRequest,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSLifecycleRemoteError,
)
from services.knowledge_fs.lifecycle_remote_http import HTTPKnowledgeFSLifecycleRemoteClient
from services.knowledge_fs_capability import CapabilityIssueRequest


def test_activation_request_is_strict_and_uses_a_safe_positive_revision() -> None:
    payload = {
        "namespace_id": "tenant-1",
        "control_space_id": "30000000-0000-4000-8000-000000000001",
        "activation_id": f"sha256:{'b' * 64}",
        "activation_revision": 12,
        "source_revision_digest": f"sha256:{'a' * 64}",
    }

    with pytest.raises(ValidationError):
        KnowledgeFSDifyIntegrationActivationRequest.model_validate({**payload, "unexpected": True})
    with pytest.raises(ValidationError):
        KnowledgeFSDifyIntegrationActivationRequest.model_validate(
            {**payload, "activation_revision": 9_007_199_254_740_992}
        )


def test_activation_uses_exact_internal_worker_capability_path_body_and_ack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="activation-capability")
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={
            "activationId": f"sha256:{'b' * 64}",
            "activationRevision": 12,
            "sourceRevisionDigest": f"sha256:{'a' * 64}",
            "namespaceId": "tenant-1",
            "activatedAt": "2026-07-21T12:00:00.000Z",
            "updatedAt": "2026-07-21T12:00:00.000Z",
            "active": True,
            "applied": True,
            "replayed": False,
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )
    request = KnowledgeFSDifyIntegrationActivationRequest(
        namespace_id="tenant-1",
        control_space_id="30000000-0000-4000-8000-000000000001",
        activation_id=f"sha256:{'b' * 64}",
        activation_revision=12,
        source_revision_digest=f"sha256:{'a' * 64}",
    )

    ack = remote.activate_dify_workspace_integration(request)

    assert ack.active is True
    assert ack.applied is True
    assert ack.replayed is False
    assert captured["method"] == "POST"
    assert captured["url"] == "https://knowledge-fs.test/internal/dify-integration/activate"
    assert captured["json"] == {
        "activationId": f"sha256:{'b' * 64}",
        "activationRevision": 12,
        "sourceRevisionDigest": f"sha256:{'a' * 64}",
    }
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer activation-capability"
    assert headers["X-Trace-Id"] == request.activation_id
    issued = issuer.issue.call_args.args[0]
    assert isinstance(issued, CapabilityIssueRequest)
    assert issued.operation_id == "activateDifyWorkspaceIntegration"
    assert issued.caller_kind == "internal_worker"
    assert issued.namespace_id == request.namespace_id
    assert issued.control_space_id == request.control_space_id
    assert issued.resource.type == "namespace"
    assert issued.resource.id == request.namespace_id
    assert issued.grant_id == request.activation_id
    assert issued.trace_id == request.activation_id


@pytest.mark.parametrize(
    "response_patch",
    [
        {"unexpected": True},
        {"namespaceId": "tenant-2"},
        {"active": False},
        {"applied": False, "replayed": False},
    ],
)
def test_activation_rejects_non_strict_or_mismatched_ack(
    monkeypatch: pytest.MonkeyPatch,
    response_patch: dict[str, object],
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="activation-capability")
    payload: dict[str, object] = {
        "activationId": f"sha256:{'b' * 64}",
        "activationRevision": 12,
        "sourceRevisionDigest": f"sha256:{'a' * 64}",
        "namespaceId": "tenant-1",
        "activatedAt": "2026-07-21T12:00:00.000Z",
        "updatedAt": "2026-07-21T12:00:00.000Z",
        "active": True,
        "applied": True,
        "replayed": False,
    }
    payload.update(response_patch)
    response = httpx.Response(200, json=payload, headers={"Content-Type": "application/json"})
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    with pytest.raises(KnowledgeFSLifecycleRemoteError):
        remote.activate_dify_workspace_integration(
            KnowledgeFSDifyIntegrationActivationRequest(
                namespace_id="tenant-1",
                control_space_id="30000000-0000-4000-8000-000000000001",
                activation_id=f"sha256:{'b' * 64}",
                activation_revision=12,
                source_revision_digest=f"sha256:{'a' * 64}",
            )
        )


def test_activation_maps_remote_revision_conflict_without_accepting_an_ack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="activation-capability")
    response = httpx.Response(
        409,
        json={"code": "DIFY_INTEGRATION_ACTIVATION_CONFLICT", "error": "conflict"},
        headers={"Content-Type": "application/json"},
    )
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    with pytest.raises(KnowledgeFSLifecycleRemoteError) as error:
        remote.activate_dify_workspace_integration(
            KnowledgeFSDifyIntegrationActivationRequest(
                namespace_id="tenant-1",
                control_space_id="30000000-0000-4000-8000-000000000001",
                activation_id=f"sha256:{'b' * 64}",
                activation_revision=12,
                source_revision_digest=f"sha256:{'a' * 64}",
            )
        )
    assert error.value.code == "KNOWLEDGE_FS_HTTP_409"


def test_freeze_uses_exact_internal_worker_capability_path_body_and_ack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="freeze-capability")
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={
            "freezeId": f"sha256:{'c' * 64}",
            "freezeRevision": 11,
            "sourceRevisionDigest": f"sha256:{'a' * 64}",
            "sourceTaskWatermark": 17,
            "namespaceId": "tenant-1",
            "frozenAt": "2026-07-21T11:55:00.000Z",
            "updatedAt": "2026-07-21T11:55:00.000Z",
            "frozen": True,
            "applied": True,
            "replayed": False,
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )
    request = KnowledgeFSDifyIntegrationFreezeRequest(
        namespace_id="tenant-1",
        control_space_id="30000000-0000-4000-8000-000000000001",
        freeze_id=f"sha256:{'c' * 64}",
        freeze_revision=11,
        source_revision_digest=f"sha256:{'a' * 64}",
        source_task_watermark=17,
    )

    ack = remote.freeze_dify_workspace_integration(request)

    assert ack.frozen is True
    assert ack.applied is True
    assert captured["method"] == "POST"
    assert captured["url"] == "https://knowledge-fs.test/internal/dify-integration/freeze"
    assert captured["json"] == {
        "freezeId": request.freeze_id,
        "freezeRevision": 11,
        "sourceRevisionDigest": request.source_revision_digest,
        "sourceTaskWatermark": 17,
    }
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer freeze-capability"
    assert headers["X-Trace-Id"] == request.freeze_id
    issued = issuer.issue.call_args.args[0]
    assert isinstance(issued, CapabilityIssueRequest)
    assert issued.operation_id == "freezeDifyWorkspaceIntegration"
    assert issued.caller_kind == "internal_worker"
    assert issued.resource.type == "namespace"
    assert issued.resource.id == request.namespace_id
    assert issued.grant_id == request.freeze_id
    assert issued.trace_id == request.freeze_id


def test_freeze_rejects_mismatched_ack(monkeypatch: pytest.MonkeyPatch) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="freeze-capability")
    response = httpx.Response(
        200,
        json={
            "freezeId": f"sha256:{'c' * 64}",
            "freezeRevision": 11,
            "sourceRevisionDigest": f"sha256:{'a' * 64}",
            "sourceTaskWatermark": 18,
            "namespaceId": "tenant-1",
            "frozenAt": "2026-07-21T11:55:00.000Z",
            "updatedAt": "2026-07-21T11:55:00.000Z",
            "frozen": True,
            "applied": True,
            "replayed": False,
        },
        headers={"Content-Type": "application/json"},
    )
    monkeypatch.setattr(ssrf_proxy, "make_request", lambda **_: response)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    with pytest.raises(KnowledgeFSLifecycleRemoteError, match="did not match"):
        remote.freeze_dify_workspace_integration(
            KnowledgeFSDifyIntegrationFreezeRequest(
                namespace_id="tenant-1",
                control_space_id="30000000-0000-4000-8000-000000000001",
                freeze_id=f"sha256:{'c' * 64}",
                freeze_revision=11,
                source_revision_digest=f"sha256:{'a' * 64}",
                source_task_watermark=17,
            )
        )


def test_provision_issues_internal_worker_capability_and_maps_exact_pending_profiles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="provision-capability")
    captured: dict[str, object] = {}
    response = httpx.Response(
        201,
        json={
            "configurationStatus": "pending-validation",
            "createdAt": "2026-07-21T12:00:00.000Z",
            "description": "Description",
            "id": "10000000-0000-4000-8000-000000000001",
            "name": "Space",
            "replayed": False,
            "revision": 1,
            "slug": "space",
            "tenantId": "tenant-1",
            "updatedAt": "2026-07-21T12:00:00.000Z",
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    result = remote.provision_integrated_space(_provision_request())

    assert result.namespace_id == "tenant-1"
    assert result.knowledge_space_id == "10000000-0000-4000-8000-000000000001"
    assert result.provisioning_key == "dify:tenant-1:space"
    assert result.revision == 1
    issued = issuer.issue.call_args.args[0]
    assert isinstance(issued, CapabilityIssueRequest)
    assert issued.caller_kind == "internal_worker"
    assert issued.operation_id == "provisionIntegratedKnowledgeSpace"
    assert issued.resource.type == "namespace"
    assert issued.resource.id == "tenant-1"
    assert captured["method"] == "POST"
    assert captured["url"] == "https://knowledge-fs.test/internal/knowledge-spaces/provision"
    assert captured["json"] == {
        "description": "Description",
        "embeddingProfile": {
            "model": "embed-v1",
            "pluginId": "vendor/embed",
            "provider": "vendor",
        },
        "iconRef": "builtin:book",
        "idempotencyKey": "dify:tenant-1:space",
        "name": "Space",
        "retrievalProfile": {
            "defaultMode": "fast",
            "reasoningModel": {
                "model": "reason-v1",
                "pluginId": "vendor/reason",
                "provider": "vendor",
            },
            "rerank": {"enabled": False},
            "scoreThreshold": {"enabled": False, "stage": "mode-final"},
            "topK": 10,
        },
        "slug": "space",
    }
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer provision-capability"
    assert headers["X-Trace-Id"] == "20000000-0000-4000-8000-000000000001"
    assert not any(name.lower() == "cookie" for name in headers)


def test_delete_maps_durable_progress_and_sends_all_lifecycle_identities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="delete-capability")
    captured: dict[str, object] = {}
    response = httpx.Response(
        202,
        json={
            "irreversibleAt": "2026-07-21T12:05:00.000Z",
            "phase": "irreversible",
            "revision": 4,
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )
    request = _deletion_request()

    progress = remote.request_integrated_deletion(request)

    assert progress.phase is KnowledgeFSDeletionPhase.IRREVERSIBLE
    assert progress.revision == 4
    assert progress.irreversible_at == datetime.fromisoformat("2026-07-21T12:05:00+00:00").replace(tzinfo=None)
    assert captured["url"] == (
        "https://knowledge-fs.test/internal/knowledge-spaces/10000000-0000-4000-8000-000000000001/delete"
    )
    assert captured["json"] == {
        "controlSpaceId": "30000000-0000-4000-8000-000000000001",
        "expectedRevision": 3,
        "idempotencyKey": "delete-space-once",
        "operationId": "40000000-0000-4000-8000-000000000001",
        "provisioningKey": "dify:tenant-1:space",
    }
    issued = issuer.issue.call_args.args[0]
    assert issued.operation_id == "deleteIntegratedKnowledgeSpace"
    assert issued.resource.type == "knowledge_space"
    assert issued.resource.id == request.knowledge_space_id


def test_revoke_capability_grant_sends_monotonic_event_and_maps_ack(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="revoke-capability")
    captured: dict[str, object] = {}
    response = httpx.Response(
        200,
        json={
            "applied": True,
            "highestRevokeSequence": 7,
            "state": "revoked",
        },
        headers={"Content-Type": "application/json"},
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return response

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )
    request = KnowledgeFSCapabilityGrantRevokeRequest(
        namespace_id="tenant-1",
        control_space_id="30000000-0000-4000-8000-000000000001",
        operation_id="40000000-0000-4000-8000-000000000002",
        idempotency_key="revoke-grant-once",
        knowledge_space_id="10000000-0000-4000-8000-000000000001",
        grant_id="50000000-0000-4000-8000-000000000001",
        event_id="60000000-0000-4000-8000-000000000001",
        reason_code="permission_revoked",
        revoke_sequence=7,
        expected_revision=4,
    )

    ack = remote.revoke_capability_grant(request)

    assert ack.applied is True
    assert ack.highest_revoke_sequence == 7
    assert ack.state == "revoked"
    assert captured["method"] == "POST"
    assert captured["url"] == (
        "https://knowledge-fs.test/internal/capability-grants/50000000-0000-4000-8000-000000000001/revoke"
    )
    assert captured["json"] == {
        "eventId": "60000000-0000-4000-8000-000000000001",
        "knowledgeSpaceId": "10000000-0000-4000-8000-000000000001",
        "reasonCode": "permission_revoked",
        "revokeSequence": 7,
    }
    issued = issuer.issue.call_args.args[0]
    assert isinstance(issued, CapabilityIssueRequest)
    assert issued.operation_id == "revokeCapabilityGrant"
    assert issued.grant_id == request.operation_id
    assert issued.resource.type == "knowledge_space"
    assert issued.resource.id == request.knowledge_space_id


def test_list_paginates_with_one_namespace_capability_and_reconstructs_provisioning_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="list-capability")
    responses = iter(
        tuple(
            response
            for _ in range(2)
            for response in (
                httpx.Response(
                    200,
                    json={"items": [_space("space-a")], "nextCursor": "cursor-2"},
                    headers={"Content-Type": "application/json"},
                ),
                httpx.Response(
                    200,
                    json={"items": [_space("space-b")], "nextCursor": None},
                    headers={"Content-Type": "application/json"},
                ),
            )
        )
    )
    requests: list[dict[str, object]] = []

    def fake_make_request(**kwargs: object) -> httpx.Response:
        requests.append(dict(kwargs))
        return next(responses)

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    control_space_id = "30000000-0000-4000-8000-000000000001"
    spaces = remote.list_spaces(namespace_id="tenant-1", control_space_id=control_space_id)

    assert [space.provisioning_key for space in spaces] == ["dify:tenant-1:space-a", "dify:tenant-1:space-b"]
    assert issuer.issue.call_count == 1
    issued = issuer.issue.call_args.args[0]
    assert issued.control_space_id == control_space_id
    assert requests[0]["params"] == (("limit", "100"),)
    assert requests[1]["params"] == (("limit", "100"), ("cursor", "cursor-2"))
    assert (
        remote.find_by_provisioning_key(
            provisioning_key="dify:tenant-1:space-b",
            control_space_id=control_space_id,
        )
        == spaces[1]
    )


def test_delete_recovers_lost_ack_space_with_real_control_identity_and_remote_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="capability")
    captured: list[dict[str, object]] = []
    responses = iter(
        (
            httpx.Response(
                200,
                json={"items": [_space("space-a", revision=7)], "nextCursor": None},
                headers={"Content-Type": "application/json"},
            ),
            httpx.Response(
                202,
                json={"phase": "accepted", "revision": 8},
                headers={"Content-Type": "application/json"},
            ),
        )
    )

    def fake_make_request(**kwargs: object) -> httpx.Response:
        captured.append(dict(kwargs))
        return next(responses)

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )
    request = _deletion_request()._replace(
        knowledge_space_id=None,
        provisioning_key="dify:tenant-1:space-a",
        expected_revision=0,
    )

    progress = remote.request_integrated_deletion(request)

    assert progress.phase is KnowledgeFSDeletionPhase.ACCEPTED
    assert progress.revision == 8
    assert captured[1]["json"] == {
        "controlSpaceId": request.control_space_id,
        "expectedRevision": 7,
        "idempotencyKey": request.idempotency_key,
        "operationId": request.operation_id,
        "provisioningKey": request.provisioning_key,
    }
    assert [call.args[0].control_space_id for call in issuer.issue.call_args_list] == [
        request.control_space_id,
        request.control_space_id,
    ]


def test_remote_rejects_unscoped_reconciliation_and_invalid_or_error_responses_before_repair(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issuer = MagicMock()
    issuer.issue.return_value = SimpleNamespace(token="capability")
    calls = 0

    def fake_make_request(**_: object) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, json={"error": "unavailable"}, headers={"Content-Type": "application/json"})

    monkeypatch.setattr(ssrf_proxy, "make_request", fake_make_request)
    monkeypatch.setattr(ssrf_proxy, "buffer_response", lambda response, **_: response)
    remote = HTTPKnowledgeFSLifecycleRemoteClient(
        base_url="https://knowledge-fs.test",
        issuer=issuer,
        timeout_seconds=3,
    )

    with pytest.raises(KnowledgeFSLifecycleRemoteError, match="namespace"):
        remote.list_spaces(control_space_id="30000000-0000-4000-8000-000000000001")
    with pytest.raises(KnowledgeFSLifecycleRemoteError, match="provisioning key"):
        remote.find_by_provisioning_key(
            provisioning_key="unscoped-key",
            control_space_id="30000000-0000-4000-8000-000000000001",
        )
    assert calls == 0

    with pytest.raises(KnowledgeFSLifecycleRemoteError) as error:
        remote.provision_integrated_space(_provision_request())
    assert error.value.code == "KNOWLEDGE_FS_HTTP_503"
    assert calls == 1


def _provision_request() -> KnowledgeFSIntegratedProvisionRequest:
    return KnowledgeFSIntegratedProvisionRequest(
        namespace_id="tenant-1",
        control_space_id="30000000-0000-4000-8000-000000000001",
        operation_id="20000000-0000-4000-8000-000000000001",
        idempotency_key="provision-space-once",
        provisioning_key="dify:tenant-1:space",
        name="Space",
        slug="space",
        icon="builtin:book",
        description="Description",
        model_intent={"model": "embed-v1", "pluginId": "vendor/embed", "provider": "vendor"},
        profile_intent={
            "defaultMode": "fast",
            "reasoningModel": {
                "model": "reason-v1",
                "pluginId": "vendor/reason",
                "provider": "vendor",
            },
            "rerank": {"enabled": False},
            "scoreThreshold": {"enabled": False, "stage": "mode-final"},
            "topK": 10,
        },
    )


def _deletion_request() -> KnowledgeFSIntegratedDeletionRequest:
    return KnowledgeFSIntegratedDeletionRequest(
        namespace_id="tenant-1",
        control_space_id="30000000-0000-4000-8000-000000000001",
        operation_id="40000000-0000-4000-8000-000000000001",
        idempotency_key="delete-space-once",
        knowledge_space_id="10000000-0000-4000-8000-000000000001",
        provisioning_key="dify:tenant-1:space",
        expected_revision=3,
    )


def _space(slug: str, *, revision: int | None = None) -> dict[str, object]:
    suffix = "1" if slug == "space-a" else "2"
    return {
        "createdAt": "2026-07-21T12:00:00.000Z",
        "id": f"10000000-0000-4000-8000-00000000000{suffix}",
        "name": slug,
        "revision": revision if revision is not None else int(suffix),
        "slug": slug,
        "tenantId": "tenant-1",
        "updatedAt": "2026-07-21T12:00:00.000Z",
    }

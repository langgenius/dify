from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from pydantic import SecretStr

import services.knowledge_fs_capability as capability_module
from services.knowledge_fs_capability import (
    KNOWLEDGE_FS_CAPABILITY_OPERATIONS,
    CapabilityAuthzRevision,
    CapabilityIssueRequest,
    CapabilityResource,
    CapabilitySigningKey,
    DifyCapabilityV2Claims,
    KnowledgeFSCapabilityConfigurationError,
    KnowledgeFSCapabilityIssuer,
    KnowledgeFSCapabilityPolicyError,
    RotatingCapabilityKeyRing,
    create_configured_knowledge_fs_capability_issuer,
)

_CAPABILITY_V2_VECTOR_PATH = (
    Path(__file__).resolve().parents[4] / "knowledge-fs" / "contracts" / "dify-capability-v2-test-vector.json"
)

# This key signs only the deterministic cross-language contract vector. Production contract files
# contain the matching public JWK and signature, never this private test fixture.
_CAPABILITY_V2_CONTRACT_TEST_PRIVATE_KEY = b"""-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCJ/swxiJ5dguan
2pZkmN90eRrW+Bom/MxWo3fURmNIX/efnUKXkXpnwbuGG33W3q5KZmA/t8wJu+Nr
33OmTg51ZtnK75MdeVe3QAyDAugDvIvFV5hVGvH5cZWqlcqbkoEx4qySav4qEwaY
wNAg5ZR6GF2hc/Uz9lPcSKFziSBI4bJXwg0bVFcbHLNr00irY1Ixsp3m+Rn+m65Q
I9SSkn02cPN8R25KgdJhDN0pl/To0jXQ958mlDMQpKt1H3T285kTz+fVA+zUKm9u
cFPyV0T1WNOnixTSpd9ekvVGx203tQkJtxgkJ1YAp2Hl9lcbSpHcaE1IU7GlJhyS
SfRb9EeNAgMBAAECggEAJs6zoQiBNN4PvMvBuKevS8OVEzhxrl4wnvrYw6dJ23w1
mLsyk4pziINYl8XadVdpX337+l9Xb7NZqSgNj4rrEQQsIqCOWF8cFmpaOmvSUN6w
1f4k1mY9/378bp0yfd7NG3jaPFD/iliQZdvvjBjUUSPSDQodvo+7FLuOP/4jyKra
a/MVf7Rko6Yv0lljnOPAcJXHvYpMGvcO/xA22FWloWoPHkQew8lUsLgWN4EYPDk4
Bx7Eb0uP+H/LVdqFx27vcZejQZbKNY1eWtOw7LSsUKjNVguOsBYKmHb9Nc1MzoSR
bwJqbVmvGIRyxBuIzAfzrU+VHh4o8zp4No+Wwe5RFwKBgQDAnerCPMOJod49kEzP
BEdq5DMeVSQSaU3ZQ25IHzUw/88pUrJ8zyP5aZMqo0PNpQPpq02w7ymJmQ7l6FFG
mpYwJQPFUEj6TCaFSg27tBI08UzxJH66JDxbKe7PTLoSQ01jeiEk3CsYv+d94A14
K9wo4j1/tUM5vu8BRwjLBmry0wKBgQC3Z4yrRqiwTdG6zpyRW/HuJVT9ht9VgKlD
iT6BaEtRS9pyVpiWyAf+XzA0xvDWHzTPKr5SAGJqILaTRB7zIJ71ZvV1shnzc0M0
riG+4v9CCwSAmKmgr1xG1uVzKNj169Yis7HnpQTkvGlr4W4nYnxd3I6Yy+tVGzh/
Fh0z5a+gHwKBgQCjsZEhIaLMBNRqXYfpJynKncUTsifFvdh7G+NNR7hcvAnChJVL
nH5mKGL5iWbGDccVfo+4Hoied4VBvf3UkuuwXsSlm2Vp0e2quRSSwKX4eFl7Vhic
+M6Sa0CYzAwWGTxbnh8sxC+cCPsi7paD2kJwPFUng1RubuWPoF7Iq9uYIQKBgA6W
qQTSuQZVGlKurpuNYcAcrhcAjHFDq7MYjqVCg4My8mxX4QlVXfVo4u+/x1Zw4wV7
k+n359wjQAKUz5VtSdehWfMDuLa5u2XMWBjT+5PoRnJoMk36xO9JlrTDUga1vLHD
82nGoY4EQqp3Iwj094mLyrfyuIRrhuHtA2OmaILnAoGBALnVoprcJC3IoUqvDV9s
3KlQqtrZCvPyMM6VL/o+ma8hPCDXRW3V07wqNEephhXTKeZFQfXilVsnMo7vfYtI
7BTcWOWEZBw8x+eSzSwJoI+oDLRvP2yEiGZNSZWyioE424kRKGL9uwjHIFVxCNpy
pgbvXici5/lNA6KDfzTp/8gk
-----END PRIVATE KEY-----
"""


def _signing_key(kid: str) -> CapabilitySigningKey:
    return CapabilitySigningKey(
        kid=kid,
        private_key=rsa.generate_private_key(public_exponent=65537, key_size=2048),
    )


def _request(
    *,
    actor: str = "dify-account:account-1",
    caller_kind: str = "interactive",
    operation_id: str = "getKnowledgeSpace",
    principal_id: str = "account-1",
    resource: CapabilityResource | None = None,
    trace_id: str = "trace-1",
) -> CapabilityIssueRequest:
    return CapabilityIssueRequest(
        actor=actor,
        authz_revision=CapabilityAuthzRevision(
            credential_revision=None,
            external_access_epoch=3,
            membership_epoch=5,
            space_acl_epoch=7,
        ),
        caller_kind=caller_kind,
        content_policy_revision=11,
        content_scope_ids=["scope-a"],
        control_space_id="control-space-1",
        grant_id="grant-1",
        namespace_id="workspace-1",
        operation_id=operation_id,
        principal_id=principal_id,
        resource=resource or CapabilityResource(type="knowledge_space", id="space-1"),
        trace_id=trace_id,
    )


def test_issuer_reproduces_the_public_capability_v2_contract_vector() -> None:
    vector = json.loads(_CAPABILITY_V2_VECTOR_PATH.read_text())
    expected_claims = DifyCapabilityV2Claims.model_validate(vector["expectedClaims"])
    private_key = serialization.load_pem_private_key(
        _CAPABILITY_V2_CONTRACT_TEST_PRIVATE_KEY,
        password=None,
    )
    assert isinstance(private_key, rsa.RSAPrivateKey)
    audit = MagicMock()
    issuer = KnowledgeFSCapabilityIssuer(
        audit=audit,
        audience=vector["audience"],
        issuer=vector["issuer"],
        key_ring=RotatingCapabilityKeyRing(
            current=CapabilitySigningKey(
                kid=vector["protectedHeader"]["kid"],
                private_key=private_key,
            )
        ),
        max_ttl_seconds=vector["ttlSeconds"],
        now=lambda: datetime.fromtimestamp(expected_claims.iat, tz=UTC),
        random_jti=lambda: expected_claims.jti,
    )
    request = CapabilityIssueRequest(
        actor=expected_claims.actor,
        authz_revision=expected_claims.authz_revision,
        caller_kind=expected_claims.caller_kind,
        content_policy_revision=expected_claims.content_policy_revision,
        content_scope_ids=expected_claims.content_scope_ids,
        control_space_id=expected_claims.control_space_id,
        grant_id=expected_claims.grant_id,
        namespace_id=expected_claims.namespace_id,
        operation_id=vector["operation"]["operationId"],
        principal_id=expected_claims.sub.removeprefix("dify-account:"),
        resource=expected_claims.resource,
        trace_id=expected_claims.trace_id,
        ttl_seconds=vector["ttlSeconds"],
    )

    issued = issuer.issue(request)

    assert issued.claims == expected_claims
    assert issued.token == vector["token"]
    assert issuer.public_jwks() == {"keys": [vector["publicJwk"]]}


def test_issuer_signs_current_rs256_key_and_audits_only_token_fingerprints() -> None:
    current = _signing_key("current-1")
    audit = MagicMock()
    issuer = KnowledgeFSCapabilityIssuer(
        audit=audit,
        key_ring=RotatingCapabilityKeyRing(current=current),
        now=lambda: datetime(2026, 7, 21, tzinfo=UTC),
        random_jti=lambda: "raw-jti-never-audit",
    )

    result = issuer.issue(_request())

    assert jwt.get_unverified_header(result.token) == {
        "alg": "RS256",
        "kid": "current-1",
        "typ": "JWT",
    }
    claims = jwt.decode(
        result.token,
        current.private_key.public_key(),
        algorithms=["RS256"],
        audience="knowledge-fs",
        issuer="dify-control-plane",
        options={"verify_exp": False},
    )
    assert claims["cap_ver"] == 2
    assert claims["sub"] == "dify-account:account-1"
    assert claims["actor"] == "dify-account:account-1"
    assert claims["caller_kind"] == "interactive"
    assert claims["azp"] == "dify-console"
    assert claims["action"] == "knowledge_spaces.read"
    assert claims["resource"] == {"id": "space-1", "parent_id": None, "type": "knowledge_space"}
    assert claims["exp"] - claims["iat"] == 60

    event = audit.record.call_args.args[0]
    serialized_event = event.model_dump(mode="json")
    assert serialized_event["trace_id"] == "trace-1"
    assert serialized_event["subject"] == "dify-account:account-1"
    assert serialized_event["actor"] == "dify-account:account-1"
    assert serialized_event["namespace_id"] == "workspace-1"
    assert serialized_event["control_space_id"] == "control-space-1"
    assert serialized_event["grant_id"] == "grant-1"
    assert serialized_event["operation_id"] == "getKnowledgeSpace"
    assert serialized_event["issued_at"] == "2026-07-21T00:00:00Z"
    assert serialized_event["expires_at"] == "2026-07-21T00:01:00Z"
    assert serialized_event["authz_revision"] == {
        "credential_revision": None,
        "external_access_epoch": 3,
        "membership_epoch": 5,
        "space_acl_epoch": 7,
    }
    assert serialized_event["content_policy_revision"] == 11
    assert serialized_event["content_scope_ids"] == ["scope-a"]
    assert serialized_event["resource_parent_id"] is None
    assert serialized_event["jti_hash"].startswith("sha256:")
    assert "raw-jti-never-audit" not in str(serialized_event)
    assert "token" not in serialized_event


def test_issuer_records_sanitized_success_and_policy_denial_metrics() -> None:
    metrics = MagicMock()
    issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        metrics=metrics,
    )

    issuer.issue(_request())
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(
            _request(
                caller_kind="interactive",
                operation_id="provisionIntegratedKnowledgeSpace",
                resource=CapabilityResource(type="namespace", id="workspace-1"),
            )
        )

    success, denied = [call.args[0] for call in metrics.record_capability_issuance.call_args_list]
    assert success == ("interactive", "getKnowledgeSpace", "issued", "success")
    assert denied == (
        "interactive",
        "provisionIntegratedKnowledgeSpace",
        "denied",
        "caller_kind_not_allowed",
    )
    assert "workspace-1" not in str((success, denied))
    assert "control-space-1" not in str((success, denied))


def test_issuer_buckets_unregistered_operation_metric_labels() -> None:
    metrics = MagicMock()
    issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        metrics=metrics,
    )

    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not registered"):
        issuer.issue(_request(operation_id="attacker-controlled-operation"))

    metric = metrics.record_capability_issuance.call_args.args[0]
    assert metric == ("interactive", "unknown", "denied", "operation_not_registered")
    assert "attacker-controlled-operation" not in str(metric)


def test_issuer_classifies_sign_and_audit_failures_without_leaking_tokens() -> None:
    sign_metrics = MagicMock()
    signing_ring = MagicMock()
    signing_ring.sign.side_effect = RuntimeError("signing HSM unavailable")
    signing_issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=signing_ring,
        metrics=sign_metrics,
    )

    with pytest.raises(RuntimeError, match="HSM"):
        signing_issuer.issue(_request())
    assert sign_metrics.record_capability_issuance.call_args.args[0] == (
        "interactive",
        "getKnowledgeSpace",
        "failed",
        "signing_failure",
    )

    audit = MagicMock()
    audit.record.side_effect = RuntimeError("audit database unavailable")
    audit_metrics = MagicMock()
    audit_issuer = KnowledgeFSCapabilityIssuer(
        audit=audit,
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        metrics=audit_metrics,
    )

    with pytest.raises(RuntimeError, match="audit database"):
        audit_issuer.issue(_request())
    assert audit_metrics.record_capability_issuance.call_args.args[0] == (
        "interactive",
        "getKnowledgeSpace",
        "failed",
        "audit_failure",
    )


def test_capability_metric_export_failure_never_changes_issuance() -> None:
    metrics = MagicMock()
    metrics.record_capability_issuance.side_effect = RuntimeError("collector unavailable")
    issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        metrics=metrics,
    )

    issued = issuer.issue(_request())

    assert issued.claims.action == "knowledge_spaces.read"


@pytest.mark.parametrize(
    ("caller_kind", "principal_id", "expected_subject", "expected_azp"),
    [
        ("interactive", "account-1", "dify-account:account-1", "dify-console"),
        ("service", "credential-1", "dify-kfs-credential:credential-1", "dify-service-api"),
        ("agent", "app-1", "dify-app:app-1", "dify-agent"),
        ("workflow", "app-1", "dify-app:app-1", "dify-workflow"),
        ("internal_worker", "indexer-1", "dify-worker:indexer-1", "dify-worker"),
    ],
)
def test_issuance_profiles_keep_principal_types_distinct(
    caller_kind: str,
    principal_id: str,
    expected_subject: str,
    expected_azp: str,
) -> None:
    audit = MagicMock()
    issuer = KnowledgeFSCapabilityIssuer(
        audit=audit,
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        random_jti=lambda: f"jti-{caller_kind}",
    )

    operation_id = "fenceCapabilityKnowledgeSpace" if caller_kind == "internal_worker" else "getKnowledgeSpace"
    claims = issuer.issue(
        _request(caller_kind=caller_kind, operation_id=operation_id, principal_id=principal_id),
    ).claims

    assert claims.sub == expected_subject
    assert claims.azp == expected_azp
    assert claims.caller_kind == caller_kind


def test_interactive_accounts_remain_distinct_in_issuance_audit() -> None:
    audit = MagicMock()
    jtis = iter(("jti-account-1", "jti-account-2"))
    issuer = KnowledgeFSCapabilityIssuer(
        audit=audit,
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
        random_jti=lambda: next(jtis),
    )

    issuer.issue(_request())
    issuer.issue(
        _request(
            actor="dify-account:account-2",
            principal_id="account-2",
            trace_id="trace-2",
        )
    )

    events = [call.args[0] for call in audit.record.call_args_list]
    assert [event.subject for event in events] == ["dify-account:account-1", "dify-account:account-2"]
    assert events[0].jti_hash != events[1].jti_hash


def test_mcp_profile_and_operation_resource_mismatches_fail_closed() -> None:
    issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
    )

    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="MCP"):
        issuer.issue(_request(caller_kind="mcp", principal_id="session-1"))

    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="resource type"):
        issuer.issue(
            _request(
                operation_id="cancelResearchTask",
                resource=CapabilityResource(type="knowledge_space", id="space-1"),
            )
        )

    for caller_kind, principal_id in (("interactive", "account-1"), ("workflow", "app-1")):
        with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
            issuer.issue(
                _request(
                    caller_kind=caller_kind,
                    operation_id="provisionIntegratedKnowledgeSpace",
                    principal_id=principal_id,
                    resource=CapabilityResource(type="namespace", id="workspace-1"),
                )
            )


def test_key_ring_publishes_current_and_previous_public_keys_for_overlap() -> None:
    previous = _signing_key("previous-1")
    current = _signing_key("current-1")
    key_ring = RotatingCapabilityKeyRing(current=current, previous=(previous.public_verification_key(),))

    jwks = key_ring.public_jwks()

    assert [key["kid"] for key in jwks["keys"]] == ["current-1", "previous-1"]
    assert all(key["alg"] == "RS256" and key["use"] == "sig" for key in jwks["keys"])
    assert all("d" not in key for key in jwks["keys"])
    with pytest.raises(KnowledgeFSCapabilityConfigurationError, match="unique"):
        RotatingCapabilityKeyRing(
            current=current,
            previous=(current.public_verification_key(),),
        )


def test_operation_registry_uses_single_actions_and_resource_types() -> None:
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["listKnowledgeSpaces"].action == "knowledge_spaces.list"
    assert "internal_worker" in KNOWLEDGE_FS_CAPABILITY_OPERATIONS["listKnowledgeSpaces"].allowed_caller_kinds
    batch = KNOWLEDGE_FS_CAPABILITY_OPERATIONS["batchKnowledgeSpaceProductSummaries"]
    assert batch.action == "knowledge_spaces.status.batch"
    assert batch.path == "/internal/knowledge-spaces/product-summaries/batch"
    assert batch.resource_type == "namespace"
    assert (
        KNOWLEDGE_FS_CAPABILITY_OPERATIONS["provisionIntegratedKnowledgeSpace"].path
        == "/internal/knowledge-spaces/provision"
    )
    activation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS["activateDifyWorkspaceIntegration"]
    assert activation == (
        "dify_integration.activate",
        ("internal_worker",),
        "POST",
        "/internal/dify-integration/activate",
        "namespace",
    )
    freeze = KNOWLEDGE_FS_CAPABILITY_OPERATIONS["freezeDifyWorkspaceIntegration"]
    assert freeze == (
        "dify_integration.freeze",
        ("internal_worker",),
        "POST",
        "/internal/dify-integration/freeze",
        "namespace",
    )
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["listDocuments"].action == "documents.list"
    expected_product_operations = {
        "createKnowledgeSpaceSource": (
            "POST",
            "/knowledge-spaces/{id}/sources",
            "sources.create",
        ),
        "getKnowledgeSpaceProductSettings": (
            "GET",
            "/knowledge-spaces/{id}/product-settings",
            "knowledge_spaces.settings.read",
        ),
        "listBackgroundTasks": (
            "GET",
            "/knowledge-spaces/{id}/background-tasks",
            "background_tasks.list",
        ),
        "listKnowledgeSpaceQualityTraces": (
            "GET",
            "/knowledge-spaces/{id}/quality/traces",
            "quality.traces.list",
        ),
        "listKnowledgeSpaceResearchTasks": (
            "GET",
            "/knowledge-spaces/{id}/research-tasks",
            "research_tasks.list",
        ),
        "listKnowledgeSpaceSources": (
            "GET",
            "/knowledge-spaces/{id}/sources",
            "sources.list",
        ),
        "updateKnowledgeSpaceProductSettings": (
            "PATCH",
            "/knowledge-spaces/{id}/product-settings",
            "knowledge_spaces.settings.update",
        ),
    }
    for operation_id, (method, path, action) in expected_product_operations.items():
        operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[operation_id]
        assert (operation.method, operation.path, operation.action) == (method, path, action)
        assert operation.resource_type == "knowledge_space"
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["cancelBackgroundTask"] == (
        "background_tasks.cancel",
        ("interactive", "service", "agent", "workflow"),
        "POST",
        "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/cancel",
        "job",
    )
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["retryBackgroundTask"] == (
        "background_tasks.retry",
        ("interactive", "service", "agent", "workflow"),
        "POST",
        "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/retry",
        "job",
    )
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["createQuery"].action == "queries.create"
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["cancelResearchTask"].resource_type == "research_task"
    stream = KNOWLEDGE_FS_CAPABILITY_OPERATIONS["streamResearchTaskProgress"]
    assert stream.action == "research_tasks.stream"
    assert stream.path == "/research-tasks/{id}/events"
    assert stream.resource_type == "research_task"
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["revokeCapabilityGrant"].action == "capability_grants.revoke"
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["fenceCapabilityKnowledgeSpace"].action == "knowledge_spaces.fence"
    assert KNOWLEDGE_FS_CAPABILITY_OPERATIONS["deleteIntegratedKnowledgeSpace"].action == "knowledge_spaces.delete"


def test_internal_control_operations_are_limited_to_service_and_worker_profiles() -> None:
    issuer = KnowledgeFSCapabilityIssuer(
        audit=MagicMock(),
        key_ring=RotatingCapabilityKeyRing(current=_signing_key("current-1")),
    )

    revoke = issuer.issue(
        _request(
            caller_kind="service",
            operation_id="revokeCapabilityGrant",
            principal_id="credential-1",
        )
    )
    fence = issuer.issue(
        _request(
            caller_kind="internal_worker",
            operation_id="fenceCapabilityKnowledgeSpace",
            principal_id="lifecycle-1",
        )
    )

    assert revoke.claims.action == "capability_grants.revoke"
    assert fence.claims.action == "knowledge_spaces.fence"
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(_request(operation_id="revokeCapabilityGrant"))
    deletion = issuer.issue(
        _request(
            caller_kind="internal_worker",
            operation_id="deleteIntegratedKnowledgeSpace",
            principal_id="lifecycle-1",
        )
    )
    assert deletion.claims.action == "knowledge_spaces.delete"
    activation = issuer.issue(
        _request(
            caller_kind="internal_worker",
            operation_id="activateDifyWorkspaceIntegration",
            principal_id="cutover-1",
            resource=CapabilityResource(type="namespace", id="workspace-1"),
        )
    )
    assert activation.claims.action == "dify_integration.activate"
    freeze = issuer.issue(
        _request(
            caller_kind="internal_worker",
            operation_id="freezeDifyWorkspaceIntegration",
            principal_id="cutover-1",
            resource=CapabilityResource(type="namespace", id="workspace-1"),
        )
    )
    assert freeze.claims.action == "dify_integration.freeze"
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(
            _request(
                caller_kind="service",
                operation_id="deleteIntegratedKnowledgeSpace",
                principal_id="credential-1",
            )
        )
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(
            _request(
                caller_kind="service",
                operation_id="activateDifyWorkspaceIntegration",
                principal_id="credential-1",
                resource=CapabilityResource(type="namespace", id="workspace-1"),
            )
        )
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(
            _request(
                caller_kind="service",
                operation_id="freezeDifyWorkspaceIntegration",
                principal_id="credential-1",
                resource=CapabilityResource(type="namespace", id="workspace-1"),
            )
        )
    with pytest.raises(KnowledgeFSCapabilityPolicyError, match="not allowed"):
        issuer.issue(
            _request(
                caller_kind="internal_worker",
                operation_id="getKnowledgeSpace",
                principal_id="lifecycle-1",
            )
        )


def test_configured_issuer_loads_private_current_and_public_previous_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current = _signing_key("current-1")
    previous = _signing_key("previous-1")
    private_pem = current.private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    previous_jwks = RotatingCapabilityKeyRing(current=previous).public_jwks()
    monkeypatch.setattr(
        capability_module,
        "dify_config",
        SimpleNamespace(
            KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE="knowledge-fs",
            KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
            KNOWLEDGE_FS_CAPABILITY_V2_ISSUER="dify-control-plane",
            KNOWLEDGE_FS_CAPABILITY_V2_MAX_TTL_SECONDS=60,
            KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS=json.dumps(previous_jwks),
            KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=SecretStr(private_pem),
            KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="current-1",
        ),
    )

    issuer = create_configured_knowledge_fs_capability_issuer(audit=MagicMock())

    assert issuer is not None
    assert [key["kid"] for key in issuer.public_jwks()["keys"]] == ["current-1", "previous-1"]
    assert all("d" not in key for key in issuer.public_jwks()["keys"])


def test_configured_issuer_rejects_private_rotation_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    current = _signing_key("current-1")
    private_pem = current.private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    private_jwk = RSAAlgorithm.to_jwk(_signing_key("previous-1").private_key, as_dict=True)
    private_jwk.update({"alg": "RS256", "kid": "previous-1", "use": "sig"})
    monkeypatch.setattr(
        capability_module,
        "dify_config",
        SimpleNamespace(
            KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE="knowledge-fs",
            KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
            KNOWLEDGE_FS_CAPABILITY_V2_ISSUER="dify-control-plane",
            KNOWLEDGE_FS_CAPABILITY_V2_MAX_TTL_SECONDS=60,
            KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS=json.dumps({"keys": [private_jwk]}),
            KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=SecretStr(private_pem),
            KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="current-1",
        ),
    )

    with pytest.raises(KnowledgeFSCapabilityConfigurationError, match="public keys only"):
        create_configured_knowledge_fs_capability_issuer(audit=MagicMock())

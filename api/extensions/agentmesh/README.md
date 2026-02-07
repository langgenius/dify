# AgentMesh Trust Extension for Dify

Cryptographic identity and trust verification for Dify agents and workflows.

## Overview

This extension adds a trust layer to Dify, enabling:

- **Cryptographic Identity** - Ed25519-based agent identities with DIDs
- **Trust Verification** - Verify agent identity before workflow execution
- **Trust Scoring** - Dynamic trust scores based on behavioral history
- **Audit Logging** - Track all trust decisions for compliance

## Installation

The extension is included in the Dify API. To enable it:

```python
from extensions.agentmesh import TrustMiddleware, CMVKIdentity

# Initialize with an identity
identity = CMVKIdentity.generate(
    name="dify-workflow-engine",
    capabilities=["workflow:*", "llm:*", "tool:*"],
    tenant_id="your-tenant-id",
)

TrustMiddleware.initialize(identity=identity, min_trust_score=0.5)
```

## Usage

### Protecting API Endpoints

```python
from extensions.agentmesh import trust_required

@app.route("/api/v1/workflows/<workflow_id>/run", methods=["POST"])
@trust_required(min_score=0.6, capabilities=["workflow:execute"])
def run_workflow(workflow_id):
    # Request is verified - peer has sufficient trust
    # Access verification result via g.trust_verification
    return execute_workflow(workflow_id)
```

### Verifying Workflow Steps

```python
from extensions.agentmesh import TrustMiddleware

trust_manager = TrustMiddleware.get_trust_manager()

# Before executing a workflow step
result = trust_manager.verify_workflow_step(
    workflow_id="wf-123",
    step_id="step-1",
    step_type="llm",
    required_capability="llm:gpt-4",
)

if result.verified:
    # Execute the step
    pass
else:
    # Log and handle failure
    logger.warning(f"Step blocked: {result.reason}")
```

### Agent-to-Agent Communication

When Dify agents communicate with external agents:

```python
from extensions.agentmesh import TrustMiddleware, CMVKIdentity

trust_manager = TrustMiddleware.get_trust_manager()

# Verify external agent before interaction
result = trust_manager.verify_peer(
    peer_did="did:cmvk:external-agent",
    peer_public_key="base64-encoded-key",
    required_capabilities=["data:read"],
    peer_capabilities=["data:read", "data:write"],
)

if result.verified:
    # Safe to interact
    response = call_external_agent(peer_did, request)
    trust_manager.record_success(peer_did)
else:
    logger.warning(f"Peer verification failed: {result.reason}")
```

## HTTP Headers

When trust is enabled, agents should include these headers:

| Header | Description |
|--------|-------------|
| `X-Agent-DID` | Agent's decentralized identifier |
| `X-Agent-Public-Key` | Base64-encoded Ed25519 public key |
| `X-Agent-Capabilities` | Comma-separated list of capabilities |
| `X-Agent-Signature` | Signature of request body (TODO: not yet verified by middleware) |

> **Note:** Request body signature verification (`X-Agent-Signature`) is documented for future implementation but is not currently enforced by the middleware. The current trust layer verifies identity presence and capabilities but does not cryptographically bind requests to the claimed identity.

## Trust Score Calculation

Trust scores range from 0.0 to 1.0:

- **0.0 - 0.3**: Untrusted (blocked by default)
- **0.3 - 0.5**: Low trust (limited operations)
- **0.5 - 0.7**: Moderate trust (standard operations)
- **0.7 - 0.9**: High trust (extended permissions)
- **0.9 - 1.0**: Trusted (full access)

Scores adjust based on:
- Successful interactions (+0.01)
- Failed interactions (-0.1 to -0.5 based on severity)
- Time decay (TODO: not yet implemented)

## Audit Log

All trust decisions are logged for compliance:

```python
audit_log = trust_manager.get_audit_log(limit=100)

# Each entry contains:
# {
#     "timestamp": "2026-02-06T22:30:00Z",
#     "action": "verify_peer",
#     "target": "did:cmvk:peer123",
#     "success": true,
#     "trust_score": 0.72,
#     "identity_did": "did:cmvk:local",
# }
```

> **Note:** Audit logs, trust scores, and verification caches are stored in in-memory process state. In multi-worker deployments (e.g., gunicorn with multiple workers), this data will not be shared across workers and will be lost on restart. For production deployments requiring persistent audit trails, consider extending the `TrustManager` to persist to an external store (Redis, PostgreSQL, etc.).

## Configuration

Environment variables (TODO: not yet wired up - currently require programmatic initialization):

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTMESH_ENABLED` | `false` | Enable trust verification |
| `AGENTMESH_MIN_TRUST` | `0.5` | Minimum trust score |
| `AGENTMESH_CACHE_TTL` | `900` | Cache TTL in seconds |

## Related

- [AgentMesh](https://github.com/imran-siddique/agent-mesh) - Trust mesh platform
- [Agent-OS](https://github.com/imran-siddique/agent-os) - Governance kernel

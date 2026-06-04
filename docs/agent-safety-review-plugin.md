# Agent Safety Review Plugin

This fork adds a deterministic pre-publish safety gate for Dify agents and
workflow apps. The goal is to review risky agent changes before they go live,
with a structured report that can be shown in the console or consumed by CI.

## What It Protects

The plugin reviews the draft workflow graph before publish and returns one of
two decisions:

- `approved`: the draft can be published.
- `blocked`: at least one high or critical finding must be fixed first.

The report includes a stable graph hash, severity counts, rule IDs, affected
node IDs, and remediation text. This makes the review replayable and suitable
for release audit trails.

## Publish Gate

The gate is called from `WorkflowService.publish_workflow(...)`, after Dify's
existing graph and agent publish validation and before the published workflow
record is created. If the review is blocked, publishing stops and no new
workflow version is created.

The same gate is also called from `RagPipelineService.publish_workflow(...)`,
so knowledge/RAG workflow releases cannot bypass the safety review path.

The console publish API returns HTTP `400` with:

```json
{
  "result": "blocked",
  "security_review": {
    "plugin": "agent-safety-review",
    "decision": "blocked",
    "summary": {
      "blocking_findings": 1
    },
    "findings": []
  }
}
```

## Manual Review API

Users can run the same review before clicking publish:

```http
POST /console/api/apps/{app_id}/workflows/draft/security-review
```

The endpoint reviews only the current draft workflow. It does not publish,
mutate, or persist the workflow.

## Current Rule Set

The first version is intentionally local and deterministic. It does not call an
LLM, so production publishing behavior is repeatable and easy to test.

Blocking rules include:

- Suspicious prompt-injection text, such as jailbreak or bypass instructions.
- Internal, local, file, or metadata-service targets.
- Dynamic outbound HTTP URLs influenced by runtime variables.
- HTTP nodes that appear to send secrets or credentials.
- Tool-using agent nodes without a detected human review step.
- Code execution nodes without a detected human review step.
- Sensitive variables combined with risky nodes and no human review step.

Warnings include:

- Outbound HTTP nodes.
- Autonomous agent strategies such as ReAct or function calling.
- Tool-using agents or code nodes protected by a human review step.
- Sensitive variables in otherwise low-risk drafts.

## Interview Demo Flow

1. Create or edit a Dify workflow with an agent node and tool access.
2. Call the manual review API and show the structured scorecard.
3. Try to publish the risky draft and show the `blocked` response.
4. Add a human approval/review node or remove the risky target.
5. Review again, then publish once the decision becomes `approved`.

This demonstrates a real Dify backend extension: it is not just an external
wrapper. The safety gate sits directly in the publish path, which is the control
point that matters before an agent change reaches production.

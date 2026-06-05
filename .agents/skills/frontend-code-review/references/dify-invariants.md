# Dify Invariants

Use these stable Dify-specific runtime rules in addition to the generic review packs.

This file is not a place for active feature notes. Do not add rules for one branch, one PR, or a short-lived product decision such as a specific agent-v2, plugin, model-provider, or onboarding task. Keep a rule here only when all of these are true:

- It is a stable Dify runtime invariant.
- Generic React, TypeScript, accessibility, dify-ui, query, or performance rules would not catch it.
- The failure mode is concrete enough to produce a file-line review finding.
- The rule is likely to remain valid across normal feature work.

## Workflow Nodes And RAG Pipe

Flag:

- Node components under `web/app/components/workflow/nodes/[nodeName]/node.tsx` importing workflow store hooks that are unavailable in RAG Pipe template rendering.
- Node UI relying on provider context that is not mounted in every rendering surface.
- Store reads in render where React Flow `useNodes` / `useEdges` provide the actual node/edge source.

Known failure mode: workflow node components can also render while creating a RAG Pipe from a template. In that context there may be no workflowStore provider, causing a blank screen.

Prefer React Flow hooks for node/edge UI consumption. Use store APIs only where the provider is guaranteed and the code path is workflow-only.

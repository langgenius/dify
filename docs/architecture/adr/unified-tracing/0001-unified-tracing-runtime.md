# ADR-0001: Define a Provider-Neutral Unified Tracing Runtime

- Status: Proposed
- Date: 2026-07-23

## Context

Dify tracing providers historically translate execution data independently. Each provider may load workflow executions, reconstruct node relationships, resolve sessions, and normalize inputs, outputs, status, and errors in its own way. Equivalent executions can consequently appear differently across providers, and every provider must repeat Dify workflow semantics.

Nested workflows expose the same problem across asynchronous trace tasks. A child task knows its logical Dify parent, but Phoenix and LangSmith require different provider-specific restoration data. The child may also run before the task that emits its parent.

Unified tracing therefore needs one runtime contract covering canonical topology, provider routing, and cross-task parent coordination. These concerns are not independently selectable: together they determine whether one Dify execution is emitted once, with a consistent hierarchy, through one tracing runtime.

## Decision

Dify introduces an opt-in provider-neutral unified tracing runtime. Dify Core constructs canonical trace fragments and coordinates cross-task relationships; provider adapters translate those fragments to provider protocols and transport them.

### Runtime ownership

Dify Core owns:

- trace and session identity;
- canonical span identity, ordering, parent relationships, names, and semantic kinds;
- workflow execution loading and hierarchy reconstruction;
- supported loop and iteration containment, including synthetic wrapper spans;
- input, output, status, error, usage, and Dify metadata normalization;
- destination compatibility and cross-task parent-context resolution;
- provider-agnostic retry signals.

A unified provider adapter owns:

- mapping canonical span kinds and fields to provider concepts;
- emitting spans in the order supplied by Core;
- creating and restoring the provider-specific portion of parent context;
- provider transport and SDK interaction.

Adapters do not query Dify workflow persistence or independently reconstruct workflow hierarchy. Core does not import provider SDKs or model canonical traces as OpenTelemetry, LangSmith runs, or another provider protocol.

### Logical trace fragments and supported topology

A workflow dispatch produces one canonical fragment containing its workflow root and the workflow node executions loaded for that run. A chatflow fragment additionally uses its message span as the fragment root and places the workflow span below it. A nested workflow remains a separate fragment with an explicit logical external parent.

Core supplies spans in deterministic parent-first order. Siblings are ordered deterministically by canonical span identity; sibling order is serialization order only and does not imply causality.

For the workflow topology currently supported by Dify:

- a predecessor becomes the parent only when its graph node identifies one execution unambiguously;
- structured iteration or loop membership produces one deterministic synthetic wrapper per container execution and index;
- the current contract covers non-nested Loop and Iteration containers;
- parallel-branch metadata does not create an additional parent relationship; persisted predecessor and containment relationships remain authoritative;
- repeated graph node identifiers are treated as ambiguous rather than guessed;
- cyclic parent edges are removed deterministically;
- a span with an ambiguous, missing, or cyclic local relationship falls back to the workflow root.

Persisted workflow and node execution identifiers are canonical identities. Synthetic wrapper identities are deterministically derived from wrapper kind, container execution identity, and iteration or loop index. Provider-native identities remain adapter concerns.

### Runtime selection and legacy isolation

Unified tracing is controlled by a global feature switch that defaults to disabled. `OpsTraceManager` is the runtime selection point:

- when disabled, every provider uses its legacy implementation;
- when enabled, a provider registered for unified tracing uses only the unified implementation;
- an unregistered provider continues to use its legacy implementation.

Selection occurs before constructing and dispatching a trace instance. A unified failure never falls back to legacy dispatch because tracing writes are non-transactional and fallback could duplicate spans or split one execution across traces.

Unified and legacy runtimes use separate provider classes, registries, cache identities, mutable SDK clients, and parent-context namespaces. Existing provider configuration persistence and management APIs remain unchanged.

### Cross-task parent coordination

Dify propagates stable logical parent identifiers through workflow execution. Provider-specific parent restoration data is exchanged only in the asynchronous tracing layer.

A unified adapter may publish the minimum provider restoration context through the Core coordinator. Context is stored temporarily under the canonical parent identifier in a unified-only namespace. The versioned envelope contains:

- provider name;
- a non-secret destination scope derived from provider endpoint and project identity;
- trace and parent identifiers;
- only the opaque provider-specific fields required to restore the parent.

Credentials are never included in the scope or envelope.

For a nested workflow, Core first resolves the logical parent's tracing destination:

- a unified parent with the same provider and destination requires compatible stored context;
- missing compatible context or temporary context-store failure is retryable;
- malformed, unsupported, or stored incompatible context is terminal;
- an absent, untraced, legacy, cross-provider, or cross-destination parent produces a new root with explicit linked-parent metadata.

For an asynchronous child whose canonical parent is known to share the destination, missing context is retryable and malformed or incompatible context is terminal. Retry exhaustion never silently converts a required compatible parent into a new root. Top-level traces do not read parent context.

Context lookup does not consume the stored value, allowing multiple children to restore the same parent. Retention is bounded and cleanup is automatic. Concrete storage technology, keys, TTL values, retry counts, and retry delays are replaceable operational mechanisms.

### Envelope compatibility

Parent-context envelopes are versioned and strictly validated. An unsupported envelope version fails closed rather than being guessed. Provider-specific restoration fields remain opaque to Core outside version, provider, destination, and structural validation. Partial per-span routing is not supported.

## Supported Semantics

Maintainers and provider adapters may rely on these invariants:

- one workflow dispatch produces one provider-neutral canonical fragment before provider translation;
- Core, not adapters, decides supported local workflow hierarchy;
- spans are supplied parent-first with deterministic, non-causal sibling ordering;
- ambiguous and cyclic persisted relationships are handled conservatively and deterministically;
- registered unified providers receive the same logical topology and normalized Dify semantics;
- one dispatch attempt uses either the unified or legacy runtime, never both;
- unified dispatch does not fall back to legacy after failure;
- compatible cross-task parents are restored from validated provider context;
- incompatible tracing destinations remain separate roots with explicit Dify correlation metadata;
- missing compatible context is distinguished from an intentionally incompatible destination;
- credentials are not coordination data and are never stored in parent-context envelopes.

## Consequences

- Provider output becomes more consistent and Dify hierarchy behavior can be tested in Core.
- Adding a unified provider requires a protocol adapter rather than another workflow hierarchy implementation.
- Nested workflow export may wait while parent context becomes available.
- Context-store availability and retention affect reliable cross-task assembly.
- During migration, registered providers retain separate legacy and unified implementations.
- Some provider capabilities have no canonical equivalent and remain adapter-local.
- Changes to canonical semantics must be evaluated against every registered unified adapter.

## Alternatives Considered

### Keep separate ADRs for model, routing, and coordination

Rejected because the three decisions jointly define one runtime contract and cannot be evaluated, selected, or reversed independently.

### Keep hierarchy reconstruction in every provider

Rejected because it duplicates Dify semantics and allows provider behavior to drift.

### Use OpenTelemetry as the Core trace model

Rejected because it would privilege OpenTelemetry-style providers and couple Core to a provider protocol.

### Replace every legacy provider at once

Rejected because an incremental, opt-in rollout preserves existing production behavior.

### Fall back to legacy after unified failure

Rejected because Dify cannot know which non-transactional provider writes already succeeded.

### Rely on provider-side eventual parent association

Rejected because provider ingestion and child-before-parent behavior differ and may be undocumented.

### Pass provider context through workflow task payloads

Rejected because provider context may not exist when a child workflow starts and would couple application execution to provider protocols.

### Emit a new root whenever compatible parent context is missing

Rejected because transient task ordering would silently and permanently corrupt hierarchy.

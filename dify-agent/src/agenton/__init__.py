"""Agenton state-only core.

Agenton core composes reusable stateless layer graph plans, creates a fresh
``CompositorRun`` for each invocation, hydrates and advances serializable layer
``runtime_state`` through run slots, and emits session snapshots. It intentionally
does not own resources, handles, clients, cleanup callbacks, or any other
non-serializable runtime object.

Each ``Compositor`` stores only graph nodes and layer providers. Every enter call
creates new layer instances, binds direct dependencies for that run, and writes
the next cross-call state to ``run.session_snapshot`` after exit. To resume a
suspended call, reuse the same compositor plan and pass the prior snapshot to a
new enter call.

``LifecycleState.ACTIVE`` is internal-only while an entry is running. External
session snapshots and hydrated input must contain only non-active lifecycle
states; ``runtime_state`` is the only mutable layer data captured by snapshots.
"""

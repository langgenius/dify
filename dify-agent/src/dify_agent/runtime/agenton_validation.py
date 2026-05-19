"""Shared validation helpers for Agenton-backed request boundaries.

Most bad Dify Agent inputs surface from Agenton as ``KeyError``, ``TypeError``,
or ``ValueError`` while graph config, per-run layer config, and session snapshot
DTOs are being validated. One smaller class of request-shaped failures appears a
bit later, during ``Compositor.enter(...)`` before the body of the entered run
executes: session snapshots may contain lifecycle states such as ``CLOSED`` that
are serializable but not enterable. Agenton reports those as ``RuntimeError``.

Dify Agent intentionally translates only these known enter-time runtime errors
into public request-validation errors. Other runtime failures still represent
execution bugs or infrastructure problems and must not be downgraded to client
input errors.
"""

_ENTER_VALIDATION_RUNTIME_ERROR_FRAGMENTS = (
    "ACTIVE snapshots are not allowed.",
    "CLOSED snapshots cannot be entered.",
)


def is_agenton_enter_validation_runtime_error(exc: RuntimeError) -> bool:
    """Return whether ``exc`` is a known Agenton enter-time input failure."""
    message = str(exc)
    return any(fragment in message for fragment in _ENTER_VALIDATION_RUNTIME_ERROR_FRAGMENTS)


__all__ = ["is_agenton_enter_validation_runtime_error"]

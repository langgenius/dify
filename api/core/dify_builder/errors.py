"""Dify Builder domain errors.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/errors.go. Go
models these as sentinel ``error`` values (``errors.New(...)``); Python has
no sentinel-error idiom, so each becomes an ``Exception`` subclass that the
``Repository``/``Runner`` layers raise and callers catch by type.
"""


class ConflictError(Exception):
    """Raised when compare_and_advance loses the version race (stale base_version)."""


class NotFoundError(Exception):
    """Raised when a session/checkpoint/run does not exist."""


class BusyError(Exception):
    """Raised when a session already has an Advance in flight.

    The per-session gate is held, so a concurrent SubmitAction is rejected.
    """


class BadRequestError(Exception):
    """A client-supplied value is invalid (e.g. an unresolvable model_config).

    Maps to HTTP 400 in services.dify_builder.wiring.dify_builder_error_response.
    """


class ModelUnavailableError(BadRequestError):
    """The chosen or default Builder model cannot be used with its current configuration."""


class DraftWouldNotStartError(ValueError):
    """Raised by the Dify port when the graph it was asked to write would fail
    at Graph.init, so nothing was written.

    Handlers catch it to say "the workflow can't start" rather than "the
    change no longer applies". A ``ValueError`` so older ``except ValueError``
    guards around the port's writes still catch it.
    """


class ProposalWouldRunWrongError(Exception):
    """Raised by an agent that has judged its OWN final proposal wrong, so it
    refuses to hand it on to be written.

    The sibling of ``DraftWouldNotStartError``, for the defects the engine
    cannot see. A draft that wires a new branch into a variable-aggregator
    without extending that aggregator's ``variables``, or that re-sends an
    array having quietly dropped an element the user configured, passes
    ``Graph.init`` and every node-data check and then runs green while
    producing nothing or the wrong thing -- so there is no engine refusal for a
    handler to catch and nothing for the write chokepoint to veto.

    Deliberately NOT a ``DraftWouldNotStartError`` and not a ``ValueError``:
    the draft WOULD start, and a broad ``except ValueError`` around a port
    write must not swallow this as if the write had been attempted. Nothing has
    been written when it is raised; the message is the engine-grounded reason,
    which handlers show at the gate and carry into the next attempt.
    """

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

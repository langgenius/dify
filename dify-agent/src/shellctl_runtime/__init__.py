"""Stdlib-only shellctl subprocess entrypoints.

This package is reserved for tmux hot-path helpers that must start quickly for
every job. Keep `__init__` import-free so `shellctl-sanitize-pty` and
`shellctl-runner-exit` do not accidentally pull in the main shellctl client or
server stacks.
"""

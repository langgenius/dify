"""Loader for the generated ``dify-agent`` CLI help snapshot."""

from __future__ import annotations

import json
from functools import cache
from importlib import resources

_HELP_RESOURCE = "_agent_cli_help.json"


@cache
def _help_table() -> dict[str, str]:
    """Load and cache the command-path -> help-text map from the JSON snapshot."""
    raw = resources.files(__package__).joinpath(_HELP_RESOURCE).read_text(encoding="utf-8")
    return json.loads(raw)


def render_agent_stub_cli_help(args: tuple[str, ...]) -> str:
    """Return the stored ``dify-agent <args> --help`` output for one command path."""
    key = " ".join(args)
    try:
        return _help_table()[key]
    except KeyError as exc:
        raise ValueError(f"unknown dify-agent command path: {key}") from exc


__all__ = ["render_agent_stub_cli_help"]

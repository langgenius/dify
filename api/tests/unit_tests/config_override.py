"""Typed config override support shared by unit-test fixtures and helpers."""

import pytest

from configs import dify_config


def apply_config_overrides(monkeypatch: pytest.MonkeyPatch, **values: object) -> None:
    """Override known DifyConfig fields for the lifetime of ``monkeypatch``."""
    unknown_fields = values.keys() - type(dify_config).model_fields.keys()
    if unknown_fields:
        raise ValueError(f"Unknown DifyConfig fields: {sorted(unknown_fields)}")

    for name, value in values.items():
        monkeypatch.setattr(dify_config, name, value)

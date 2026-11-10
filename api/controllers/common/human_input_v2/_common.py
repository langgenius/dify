"""Strict request base shared by Human Input v2 credential contracts."""

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """Base request model that forbids unknown fields while accepting JSON-native values."""

    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)

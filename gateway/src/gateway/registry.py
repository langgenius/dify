"""Customer registry: maps SDK keys to Dify deployments + permitted models.

Loads a YAML file at startup and resolves SDK keys to ``CustomerEntry`` objects.
The registry is intentionally read-only at runtime; reload requires process restart.

Format (see ``registry.example.yaml``):

.. code-block:: yaml

    customers:
      - sdk_key: "bsa_dev_..."
        customer_id: "customer-a"
        dify:
          base_url: "http://dify-customer-a:5001"
          console_email: "..."
          console_password: "..."
          dataset_api_key: "..."
        models:
          - id: "qwen3.6-35b"
            provider: "..."
            name: "..."
            completion_params: {temperature: 0.3}
        knowledge_bases: []

Invariants:
    * SDK keys are unique across the registry; duplicates raise on load.
    * Each customer must declare at least one model.
    * Model IDs are unique within a customer.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ModelEntry(BaseModel):
    """A single model the customer is allowed to invoke.

    ``id`` is the customer-facing identifier passed in ``extra_body.llm_model``.
    ``provider``/``name``/``completion_params`` are written into Dify Apps when
    the gateway lazy-builds an App for ``(customer_id, model_id)``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    name: str = Field(min_length=1)
    completion_params: dict[str, Any] = Field(default_factory=dict)


class DifyConnection(BaseModel):
    """Connection details for the customer's Dify deployment."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    base_url: str = Field(min_length=1)
    console_email: str = Field(min_length=1)
    console_password: str = Field(min_length=1)
    dataset_api_key: str = Field(min_length=1)


class CustomerEntry(BaseModel):
    """A fully resolved customer registry row."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sdk_key: str = Field(min_length=1)
    customer_id: str = Field(min_length=1)
    dify: DifyConnection
    models: list[ModelEntry] = Field(min_length=1)
    knowledge_bases: list[str] = Field(default_factory=list)

    @field_validator("models")
    @classmethod
    def _unique_model_ids(cls, models: list[ModelEntry]) -> list[ModelEntry]:
        ids = [m.id for m in models]
        if len(ids) != len(set(ids)):
            raise ValueError("model ids must be unique within a customer")
        return models

    def find_model(self, model_id: str) -> ModelEntry | None:
        """Return the model entry matching ``model_id`` or None."""
        return next((m for m in self.models if m.id == model_id), None)

    def default_model(self) -> ModelEntry:
        """Return the first declared model (used when client omits ``llm_model``)."""
        return self.models[0]


class CustomerRegistry:
    """In-memory registry indexed by SDK key.

    Construct via :meth:`from_yaml` to load from disk. The class itself is just
    a thin wrapper over a ``dict[str, CustomerEntry]``; tests can build instances
    directly via :meth:`from_entries`.
    """

    def __init__(self, by_sdk_key: dict[str, CustomerEntry]) -> None:
        self._by_sdk_key = by_sdk_key

    @classmethod
    def from_entries(cls, entries: list[CustomerEntry]) -> "CustomerRegistry":
        """Build a registry from a list of entries (raises on duplicate SDK keys)."""
        by_key: dict[str, CustomerEntry] = {}
        for entry in entries:
            if entry.sdk_key in by_key:
                raise ValueError(f"duplicate sdk_key in registry: {entry.sdk_key}")
            by_key[entry.sdk_key] = entry
        return cls(by_key)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "CustomerRegistry":
        """Load and validate a registry YAML file.

        Raises:
            FileNotFoundError: path does not exist.
            ValueError: malformed YAML, schema violation, or duplicate keys.
        """
        p = Path(path)
        if not p.is_file():
            raise FileNotFoundError(f"registry file not found: {p}")

        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8"))
        except yaml.YAMLError as e:
            raise ValueError(f"invalid YAML in {p}: {e}") from e

        if not isinstance(raw, dict) or "customers" not in raw:
            raise ValueError(f"registry root must be a mapping with key 'customers' in {p}")

        try:
            entries = [CustomerEntry.model_validate(c) for c in raw["customers"]]
        except Exception as e:
            raise ValueError(f"registry validation failed in {p}: {e}") from e

        return cls.from_entries(entries)

    def lookup(self, sdk_key: str) -> CustomerEntry | None:
        """Return the customer for ``sdk_key`` or None if unknown."""
        return self._by_sdk_key.get(sdk_key)

    def find_by_customer_id(self, customer_id: str) -> CustomerEntry | None:
        """Return the (first) customer entry whose customer_id matches.

        Note:
            Currently O(N). The registry is intended to hold ≲100 customers per
            gateway instance; if this assumption changes, add an inverted index.
        """
        for entry in self._by_sdk_key.values():
            if entry.customer_id == customer_id:
                return entry
        return None

    def customers(self) -> list[CustomerEntry]:
        """Return all customer entries (no order guarantee)."""
        return list(self._by_sdk_key.values())

    def __len__(self) -> int:
        return len(self._by_sdk_key)

    def __contains__(self, sdk_key: str) -> bool:
        return sdk_key in self._by_sdk_key

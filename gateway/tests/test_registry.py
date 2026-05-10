"""Tests for the customer registry loader."""

from __future__ import annotations

from pathlib import Path

import pytest

from gateway.registry import CustomerEntry, CustomerRegistry, DifyConnection, ModelEntry


def _make_entry(
    sdk_key: str = "bsa_dev_abc",
    customer_id: str = "customer-a",
    model_ids: tuple[str, ...] = ("qwen3.6-35b",),
) -> CustomerEntry:
    return CustomerEntry(
        sdk_key=sdk_key,
        customer_id=customer_id,
        dify=DifyConnection(
            base_url="http://dify:5001",
            console_email="admin@example.com",
            console_password="pw",
            dataset_api_key="dataset-xxx",
        ),
        models=[
            ModelEntry(id=mid, provider="prov", name="name", completion_params={})
            for mid in model_ids
        ],
        knowledge_bases=[],
    )


class TestRegistryFromEntries:
    def test_lookup_returns_entry_for_known_sdk_key(self) -> None:
        entry = _make_entry()
        registry = CustomerRegistry.from_entries([entry])
        assert registry.lookup("bsa_dev_abc") is entry

    def test_lookup_returns_none_for_unknown_key(self) -> None:
        registry = CustomerRegistry.from_entries([_make_entry()])
        assert registry.lookup("bsa_nope") is None

    def test_contains(self) -> None:
        registry = CustomerRegistry.from_entries([_make_entry("bsa_a"), _make_entry("bsa_b", "cust-b")])
        assert "bsa_a" in registry
        assert "bsa_b" in registry
        assert "bsa_x" not in registry

    def test_len_counts_entries(self) -> None:
        registry = CustomerRegistry.from_entries(
            [_make_entry("bsa_a"), _make_entry("bsa_b", "cust-b")]
        )
        assert len(registry) == 2

    def test_duplicate_sdk_key_rejected(self) -> None:
        with pytest.raises(ValueError, match="duplicate sdk_key"):
            CustomerRegistry.from_entries(
                [_make_entry("bsa_dup"), _make_entry("bsa_dup", "cust-b")]
            )


class TestCustomerEntryValidation:
    def test_at_least_one_model_required(self) -> None:
        with pytest.raises(ValueError):
            CustomerEntry(
                sdk_key="bsa_x",
                customer_id="c",
                dify=DifyConnection(
                    base_url="http://x",
                    console_email="a@b",
                    console_password="p",
                    dataset_api_key="d",
                ),
                models=[],
            )

    def test_duplicate_model_ids_rejected(self) -> None:
        with pytest.raises(ValueError, match="model ids must be unique"):
            _make_entry(model_ids=("m1", "m1"))

    def test_find_model_returns_match(self) -> None:
        entry = _make_entry(model_ids=("a", "b", "c"))
        m = entry.find_model("b")
        assert m is not None
        assert m.id == "b"

    def test_find_model_returns_none_when_missing(self) -> None:
        entry = _make_entry(model_ids=("a",))
        assert entry.find_model("z") is None

    def test_default_model_is_first(self) -> None:
        entry = _make_entry(model_ids=("first", "second"))
        assert entry.default_model().id == "first"

    def test_extra_fields_forbidden(self) -> None:
        with pytest.raises(ValueError):
            CustomerEntry(  # type: ignore[call-arg]
                sdk_key="bsa_x",
                customer_id="c",
                dify=DifyConnection(
                    base_url="http://x",
                    console_email="a@b",
                    console_password="p",
                    dataset_api_key="d",
                ),
                models=[ModelEntry(id="m", provider="p", name="n")],
                bogus_field="should_fail",
            )


class TestRegistryFromYaml:
    def test_loads_valid_yaml(self, tmp_path: Path) -> None:
        f = tmp_path / "reg.yaml"
        f.write_text(
            """
customers:
  - sdk_key: "bsa_a"
    customer_id: "cust-a"
    dify:
      base_url: "http://a:5001"
      console_email: "a@x"
      console_password: "pw"
      dataset_api_key: "ds"
    models:
      - id: "m1"
        provider: "p"
        name: "n"
""",
            encoding="utf-8",
        )
        reg = CustomerRegistry.from_yaml(f)
        assert reg.lookup("bsa_a") is not None
        assert reg.lookup("bsa_a").customer_id == "cust-a"  # type: ignore[union-attr]

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            CustomerRegistry.from_yaml(tmp_path / "nope.yaml")

    def test_invalid_yaml_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "bad.yaml"
        f.write_text("customers: [unclosed", encoding="utf-8")
        with pytest.raises(ValueError, match="invalid YAML"):
            CustomerRegistry.from_yaml(f)

    def test_root_without_customers_key_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "wrong.yaml"
        f.write_text("foo: bar", encoding="utf-8")
        with pytest.raises(ValueError, match="must be a mapping with key 'customers'"):
            CustomerRegistry.from_yaml(f)

    def test_schema_violation_in_yaml_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "bad-schema.yaml"
        f.write_text(
            """
customers:
  - sdk_key: "x"
    customer_id: "c"
    dify:
      base_url: "http://x"
      console_email: "a@b"
      console_password: "p"
      dataset_api_key: "d"
    models: []
""",
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="validation failed"):
            CustomerRegistry.from_yaml(f)

    def test_duplicate_sdk_key_in_yaml_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "dup.yaml"
        f.write_text(
            """
customers:
  - sdk_key: "bsa_dup"
    customer_id: "c1"
    dify: {base_url: "http://x", console_email: "a@b", console_password: "p", dataset_api_key: "d"}
    models: [{id: "m", provider: "p", name: "n"}]
  - sdk_key: "bsa_dup"
    customer_id: "c2"
    dify: {base_url: "http://x", console_email: "a@b", console_password: "p", dataset_api_key: "d"}
    models: [{id: "m", provider: "p", name: "n"}]
""",
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="duplicate sdk_key"):
            CustomerRegistry.from_yaml(f)

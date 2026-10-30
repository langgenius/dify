import json

import pytest
from pydantic import ValidationError

from graphon.model_runtime.entities.model_entities import ModelType
from services.entities.model_billing_migration import canonical_hash
from services.model_billing_retirement_policy import resolve_retirement_policy


def declaration(model: str = "gpt-3.5-turbo", revision: str = "new") -> dict[str, object]:
    return {
        "schema_version": 1,
        "mapping_revision": revision,
        "provider_id": "langgenius/openai/openai",
        "model_type": "llm",
        "model": model,
    }


def test_default_and_other_revisions_keep_original_inventory_hash() -> None:
    models = [{"provider": "langgenius/openai/openai", "model_type": "llm", "model": "gpt-4o"}]
    for raw in ("[]", json.dumps([declaration()])):
        policy = resolve_retirement_policy(raw, "old")
        assert not policy.identities
        assert policy.inventory_payload(models, []) is models
        assert canonical_hash(policy.inventory_payload(models, [])) == canonical_hash(models)


def test_revision_provider_and_type_are_exact_without_latest_or_aliases() -> None:
    policy = resolve_retirement_policy(json.dumps([declaration()]), "new")
    assert policy.for_provider("langgenius/openai/openai") == frozenset({(ModelType.LLM, "gpt-3.5-turbo")})
    assert not policy.for_provider("openai")
    assert not policy.for_provider("langgenius/tongyi/tongyi")
    assert not resolve_retirement_policy(json.dumps([declaration()]), "newer").identities


def test_policy_digest_is_order_independent_and_frozen_into_inventory() -> None:
    first = resolve_retirement_policy(json.dumps([declaration(), declaration("o3-mini")]), "new")
    second = resolve_retirement_policy(json.dumps([declaration("o3-mini"), declaration()]), "new")
    assert first.digest == second.digest
    changed = resolve_retirement_policy(json.dumps([declaration()]), "new")
    assert first.digest != changed.digest
    assert canonical_hash(first.inventory_payload([], [])) != canonical_hash(changed.inventory_payload([], []))
    assert canonical_hash(first.inventory_payload([], [{"model": "o3-mini"}])) != canonical_hash(
        first.inventory_payload([], [])
    )


@pytest.mark.parametrize(
    "raw",
    [
        "invalid-json",
        "{}",
        json.dumps([{**declaration(), "provider_id": "openai"}]),
        json.dumps([{**declaration(), "provider_id": "langgenius/*/openai"}]),
        json.dumps([{**declaration(), "model_type": "unknown"}]),
        json.dumps([{**declaration(), "mapping_revision": ""}]),
        json.dumps([{**declaration(), "model": ""}]),
        json.dumps([{**declaration(), "fallback": "legacy"}]),
    ],
)
def test_malformed_retirement_policy_fails_closed(raw: str) -> None:
    with pytest.raises(ValidationError):
        resolve_retirement_policy(raw, "new")


def test_duplicate_within_revision_rejected_but_versions_can_coexist() -> None:
    with pytest.raises(ValueError, match="Duplicate"):
        resolve_retirement_policy(json.dumps([declaration(), declaration()]), "new")
    policy = resolve_retirement_policy(json.dumps([declaration(), declaration(revision="later")]), "new")
    assert len(policy.identities) == 1

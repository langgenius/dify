"""Static wire fixtures validate against JSON Schema and actual Pydantic owners."""

import copy
import json
from operator import itemgetter
from pathlib import Path
from typing import TypedDict

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError

from dev.generate_model_billing_migration_contract import MODELS, build_free_schema, build_schema, free_fixture

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
SCHEMA = json.loads((CONTRACTS / "model-billing-migration-v1.schema.json").read_text())
FIXTURES = json.loads((CONTRACTS / "model-billing-migration-v1.fixtures.json").read_text())


class WireFixture(TypedDict):
    id: str
    definition: str
    value: object
    valid: bool


def test_committed_contract_matches_pydantic_owners_and_keeps_strict_records() -> None:
    assert build_schema() == SCHEMA
    assert SCHEMA["x-contract-revision"] == "1.1"
    Draft202012Validator.check_schema(SCHEMA)
    for definition in SCHEMA["$defs"].values():
        if definition.get("type") == "object" and "properties" in definition:
            assert definition["additionalProperties"] is False


def test_free_contract_is_additive_and_keeps_the_paid_v1_snapshot_owner() -> None:
    schema = json.loads((CONTRACTS / "model-billing-migration-free-v2.schema.json").read_text())
    assert schema == build_free_schema()
    assert schema["x-contract-revision"] == "1.2"
    assert build_schema() == SCHEMA
    assert SCHEMA["x-contract-revision"] == "1.1"
    assert "free_grant_manifest" not in SCHEMA["$defs"]["MigrationStatusResponse"]["properties"]
    assert "free_grant_manifest" in schema["$defs"]["CurrentMigrationStatusResponse"]["properties"]
    fixture = json.loads((CONTRACTS / "fixtures/tokener_migration_free_grant_v2.json").read_text())
    assert fixture == free_fixture()
    validator = Draft202012Validator({**schema, "$ref": "#/$defs/FreeGrantManifest"})
    validator.validate(fixture["manifest"])


@pytest.mark.parametrize("fixture", FIXTURES, ids=itemgetter("id"))
def test_static_cross_service_wire_fixture(fixture: WireFixture) -> None:
    selected = {**copy.deepcopy(SCHEMA), "$ref": "#/$defs/" + fixture["definition"]}
    errors = list(Draft202012Validator(selected, format_checker=FormatChecker()).iter_errors(fixture["value"]))
    assert bool(errors) != fixture["valid"], [error.message for error in errors]
    owner = MODELS[fixture["definition"]]
    if fixture["valid"]:
        owner.model_validate(fixture["value"])
    else:
        with pytest.raises(ValidationError):
            owner.model_validate(fixture["value"])

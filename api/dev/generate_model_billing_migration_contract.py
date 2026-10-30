"""Export the unreleased Core migration wire contract from its Pydantic owners.

Run from the repository root with ``uv run --project api python
api/dev/generate_model_billing_migration_contract.py``. This only writes static
schemas/fixtures; it performs no migration, Stripe action or financial call.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from controllers.inner_api.model_billing_migration import (  # noqa: E402 - standalone CLI first adds the API import root
    CurrentMigrationStatusResponse,
    MigrationErrorResponse,
    MigrationOperationResult,
    MigrationStatusResponse,
)
from services.entities.model_billing_migration import (  # noqa: E402 - standalone CLI first adds the API import root
    ActivateMigrationPayload,
    ClaimFreeMigrationPayload,
    CommandReceipt,
    ContractEventPayload,
    DecideCyclePayload,
    FreeGrantManifest,
    FundingReceiptsPayload,
    LeasePayload,
    MigrationWindow,
    PrepareMigrationPayload,
    WindowManifest,
    canonical_hash,
)

MODELS = {
    "PrepareRequest": PrepareMigrationPayload,
    "DecideCycleRequest": DecideCyclePayload,
    "LeaseRequest": LeasePayload,
    "FundingReceiptsRequest": FundingReceiptsPayload,
    "ContractEventRequest": ContractEventPayload,
    "ActivateRequest": ActivateMigrationPayload,
    "Window": MigrationWindow,
    "WindowManifest": WindowManifest,
    "CommandReceipt": CommandReceipt,
    "OperationResult": MigrationOperationResult,
    "StatusResponse": MigrationStatusResponse,
    "ErrorResponse": MigrationErrorResponse,
}

# The paid v1 model map and emitted snapshot remain byte-for-byte frozen. Free
# funding extends current status through a separate owner and additive contract.
FREE_MODELS = {
    "ClaimFreeRequest": ClaimFreeMigrationPayload,
    "FreeGrantManifest": FreeGrantManifest,
    "FreeStatusResponse": CurrentMigrationStatusResponse,
    "FundingReceiptsRequest": FundingReceiptsPayload,
    "ActivateRequest": ActivateMigrationPayload,
}


def build_free_schema() -> dict[str, Any]:
    definitions: dict[str, Any] = {}
    for alias, model in FREE_MODELS.items():
        schema = model.model_json_schema(ref_template="#/$defs/{model}")
        for name, definition in schema.pop("$defs", {}).items():
            if name in definitions and definitions[name] != definition:
                raise ValueError(f"Conflicting free contract owner: {name}")
            definitions[name] = definition
        definitions[model.__name__] = schema
        if alias != model.__name__:
            definitions[alias] = {"$ref": "#/$defs/" + model.__name__}
    # Mirror the current status owner's cross-field validator without changing
    # the historical paid StatusResponse definition or its snapshot bytes.
    definitions["CurrentMigrationStatusResponse"]["not"] = {"required": ["manifest", "free_grant_manifest"]}
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Dify one-time free model-billing migration manifest v2",
        "x-contract-revision": "1.2",
        "$comment": (
            "Additive free grant contract; HTTP api_version remains 1. Paid WindowManifest v1 is unchanged. "
            "Runtime additionally enforces exact grant identity/body hash, lease, row-lock/CAS, "
            "mutually exclusive funding kinds and verified readback before activation."
        ),
        "$defs": _wire_schema(definitions),
    }


def free_fixture() -> dict[str, Any]:
    manifest = FreeGrantManifest(
        schema_version=2,
        funding_kind="one_time_trial_grant",
        tenant_id="11111111-1111-4111-8111-111111111111",
        migration_id="22222222-2222-4222-8222-222222222222",
        plan_revision=1,
        grant_id="trial.v1.11111111-1111-4111-8111-111111111111",
        external_ref="11111111-1111-4111-8111-111111111111",
        amount_usd_micro="250000",
        occurred_at="2026-09-02T01:02:03.456Z",
        amount_policy_version="signup-trial-v1",
        model_mapping_version="hosted-v1",
    )
    data = manifest.model_dump(mode="json")
    return {
        "manifest": data,
        "manifest_hash": canonical_hash(data),
        "partner_payload": manifest.partner_payload(),
        "partner_payload_hash": canonical_hash(manifest.partner_payload()),
        "command_id": "grant:" + manifest.grant_id,
        "remote_id": manifest.grant_id,
    }


def _wire_schema(value: Any) -> Any:
    """Omitted optionals are never explicit null on the actual wire.

    Request StrictPayload rejects supplied null; responses use exclude_none=True.
    Pydantic's internal optional defaults remain useful without advertising null
    as an accepted wire value. No additionalProperties prohibition is removed.
    """
    if isinstance(value, list):
        return [_wire_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: _wire_schema(item) for key, item in value.items() if not (key == "default" and item is None)}
    if "anyOf" in result:
        choices = [item for item in result["anyOf"] if item != {"type": "null"}]
        if len(choices) == 1:
            result.pop("anyOf")
            result.update(choices[0])
        else:
            result["anyOf"] = choices
    return result


def build_schema() -> dict[str, Any]:
    definitions: dict[str, Any] = {}
    for alias, model in MODELS.items():
        schema = model.model_json_schema(ref_template="#/$defs/{model}")
        for name, definition in schema.pop("$defs", {}).items():
            if name in definitions and definitions[name] != definition:
                raise ValueError(f"Conflicting Pydantic schema owner: {name}")
            definitions[name] = definition
        definitions[model.__name__] = schema
        if alias != model.__name__:
            definitions[alias] = {"$ref": "#/$defs/" + model.__name__}
    definitions = _wire_schema(definitions)
    # These mirror the owners' model_validator cross-field shape constraints;
    # date ordering, hashes, ownership and transactional checks remain runtime.
    definitions["DecideCyclePayload"]["allOf"] = [
        {
            "if": {"properties": {"decision": {"const": "tokener"}}, "required": ["decision"]},
            "then": {"required": ["manifest", "manifest_hash"]},
            "else": {"not": {"anyOf": [{"required": ["manifest"]}, {"required": ["manifest_hash"]}]}},
        }
    ]
    definitions["LeasePayload"]["allOf"] = [
        {
            "if": {"properties": {"action": {"enum": ["renew", "release"]}}, "required": ["action"]},
            "then": {"required": ["lease_token"]},
        }
    ]
    definitions["ContractEventPayload"]["dependentRequired"] = {
        "replacement_manifest": ["replacement_manifest_hash"],
        "replacement_manifest_hash": ["replacement_manifest"],
    }
    definitions["ContractEventPayload"]["allOf"] = [
        {
            "if": {"properties": {"terminal": {"const": True}}, "required": ["terminal"]},
            "then": {
                "not": {"anyOf": [{"required": ["replacement_manifest"]}, {"required": ["replacement_manifest_hash"]}]},
                "properties": {
                    "command_payloads": {
                        "items": {
                            "properties": {
                                "target_amount_usd_micro": {"const": "0"},
                                "delta_usd_micro": {"pattern": "^(0|-[1-9][0-9]*)$"},
                            }
                        }
                    }
                },
            },
        },
        {
            "if": {"properties": {"affected_window_ids": {"minItems": 1}}, "required": ["affected_window_ids"]},
            "then": {"required": ["command_payloads"], "properties": {"command_payloads": {"minItems": 1}}},
        },
        {
            "if": {"properties": {"manual_replan": {"const": True}}, "required": ["manual_replan"]},
            "then": {
                "required": ["replacement_manifest", "replacement_manifest_hash"],
                "properties": {"event_type": {"const": "plan_change"}, "terminal": {"const": False}},
            },
        },
    ]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Dify model-billing migration API v1 — implementation contract revision 1.1",
        "x-contract-revision": "1.1",
        "$comment": (
            "Generated from Pydantic request/response owners. API api_version remains 1 "
            "because this feature is unreleased. "
            "POST returns current authoritative status; replayed_operation is the immutable original result. "
            "Lease replay consumers must not adopt a successor token from current status. "
            "Runtime additionally enforces date ordering, hash equality, command ownership, terminal fences and CAS."
        ),
        "$defs": definitions,
    }


def implementation_vectors(existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Preserve existing examples and add concrete Go-compatible v1.1 records."""
    result = copy.deepcopy(existing)
    for vector in result:
        if vector.get("definition") == "StatusResponse" and vector.get("valid"):
            state = vector["value"]
            state.setdefault(
                "model_mapping_version", state.get("manifest", {}).get("model_mapping_version", "hosted-v1")
            )
            state.setdefault("inventory_hash", "sha256:" + "1" * 64)
            state.setdefault("cycle_decisions", [])
            state.setdefault("ever_activated", state.get("phase") == "active")
            state.setdefault("contract_events", {})
            state.setdefault("prior_manifests", [])
            state.setdefault("terminated_contract_refs", [])
    source = next(item["value"] for item in result if item.get("id") == "valid-tokener-decision")
    window = copy.deepcopy(source["manifest"]["windows"][0])
    command = {
        "command_id": "dify.correction.v2.fixture",
        "window": window,
        "delta_usd_micro": "-5000000",
        "target_amount_usd_micro": "0",
    }
    command["payload_hash"] = canonical_hash(command)
    event = {
        "api_version": 1,
        "operation_id": "44444444-4444-4444-8444-444444444444",
        "expected_revision": 8,
        "business_event_ref": "re_fixture_actual_refund",
        "contract_ref": source["contract_ref"],
        "billing_receipt_ref": "receipt-fixture",
        "event_type": "refund",
        "terminal": True,
        "affected_window_ids": [window["window_id"]],
        "command_payloads": [command],
    }
    additions = [
        ("implementation-terminal-frozen-command", "ContractEventRequest", True, event),
        ("implementation-reject-extra-event-field", "ContractEventRequest", False, {**event, "wallet_balance": "0"}),
        (
            "implementation-reject-event-without-type",
            "ContractEventRequest",
            False,
            {k: v for k, v in event.items() if k != "event_type"},
        ),
        ("implementation-reject-unfrozen-correction", "ContractEventRequest", False, {**event, "command_payloads": []}),
    ]
    state = copy.deepcopy(next(item["value"] for item in result if item.get("id") == "recoverable-status"))
    state.update(
        phase="blocked",
        blocked_from="active",
        ever_activated=True,
        pending_contract_event=event,
        contract_events={event["business_event_ref"]: event},
        terminated_contract_refs=[event["contract_ref"]],
    )
    additions.append(("implementation-status-with-pending-terminal-event", "StatusResponse", True, state))
    replay = copy.deepcopy(state)
    replay.update(
        replayed=True,
        replayed_operation={
            "operation_id": "55555555-5555-4555-8555-555555555555",
            "request_hash": "sha256:" + "2" * 64,
            "result_code": 200,
            "result_revision": 5,
            "result_summary": {"phase": "claimed", "route_epoch": 1},
            "lease_action": "acquire",
            "lease_token": "66666666-6666-4666-8666-666666666666",
            "lease_expires_at": "2027-06-17T00:01:00Z",
        },
    )
    additions.append(("implementation-replayed-original-lease-receipt", "StatusResponse", True, replay))
    result = [item for item in result if not item["id"].startswith("implementation-")]
    result.extend(
        {"id": name, "schema": "migration.schema.json", "definition": definition, "valid": valid, "value": value}
        for name, definition, valid, value in additions
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=API_ROOT / "contracts/model-billing-migration-v1.schema.json")
    parser.add_argument("--research-pack", type=Path)
    parser.add_argument("--go-fixtures-dir", type=Path)
    parser.add_argument(
        "--free-output", type=Path, default=API_ROOT / "contracts/model-billing-migration-free-v2.schema.json"
    )
    parser.add_argument(
        "--free-fixture-output",
        type=Path,
        default=API_ROOT / "contracts/fixtures/tokener_migration_free_grant_v2.json",
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = json.dumps(build_schema(), ensure_ascii=False, indent=2) + "\n"
    free_content = json.dumps(build_free_schema(), ensure_ascii=False, indent=2) + "\n"
    fixture_content = json.dumps(free_fixture(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text() != content:
            raise SystemExit("Migration contract is stale; regenerate from its Pydantic owners")
        if not args.free_output.exists() or args.free_output.read_text() != free_content:
            raise SystemExit("Free migration contract is stale; regenerate from its Pydantic owners")
        if not args.free_fixture_output.exists() or args.free_fixture_output.read_text() != fixture_content:
            raise SystemExit("Free migration fixture is stale; regenerate from its Pydantic owners")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content)
    args.free_output.parent.mkdir(parents=True, exist_ok=True)
    args.free_output.write_text(free_content)
    args.free_fixture_output.parent.mkdir(parents=True, exist_ok=True)
    args.free_fixture_output.write_text(fixture_content)
    if args.research_pack:
        (args.research_pack / "migration.schema.json").write_text(content)
        vectors = implementation_vectors(json.loads((args.research_pack / "schema-vectors.json").read_text()))
        (args.research_pack / "schema-vectors.json").write_text(
            json.dumps(vectors, ensure_ascii=False, indent=2) + "\n"
        )
        destination = API_ROOT / "contracts/model-billing-migration-v1.fixtures.json"
        destination.write_text(
            json.dumps([v for v in vectors if v["schema"] == "migration.schema.json"], ensure_ascii=False, indent=2)
            + "\n"
        )
    if args.go_fixtures_dir:
        fixtures = API_ROOT / "contracts/fixtures"
        fixtures.mkdir(parents=True, exist_ok=True)
        for name in ("tokener_migration_manifest_v1.json", "tokener_manual_replan_v1.json"):
            value = json.loads((args.go_fixtures_dir / name).read_text())
            (fixtures / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()

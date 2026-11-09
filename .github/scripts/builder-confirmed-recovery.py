"""Run the real PostgreSQL/Redis recovery owners and require exact passing coverage."""

import tomllib
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

import dify_agent
import pytest

# API-installed SDK must be this checkout, with the missing server extra pinned by its own lock.
assert Path(dify_agent.__file__).resolve().is_relative_to(Path("dify-agent/src").resolve())
packages = tomllib.loads(Path("dify-agent/uv.lock").read_text())["package"]
assert next(package["version"] for package in packages if package["name"] == "jwcrypto") == "1.5.7"

EXPECTED = {
    "tests.integration_tests.services.dify_builder.test_agent_recovery_postgres": {
        "test_real_postgres_coalesces_two_keys_and_one_reserved_to_creating": 1,
        "test_real_postgres_snapshot_and_reservation_have_one_ordering_owner": 1,
        "test_real_postgres_finalization_rolls_back_and_retries_same_confirmed_allocation": 1,
    },
    "tests.integration_tests.services.dify_builder.test_confirmed_snapshot_owner": {
        "test_actual_owned_initial_capture_and_store": 1,
        "test_enterprise_absence_keeps_protected_recovery_eligibility_without_grants": 1,
        "test_confirmed_node_captures_before_stream_and_persists_both_terminal_branches": 4,
        "test_recovery_config_payload_wraps_acknowledged_random_receipt": 1,
        "test_actual_acknowledged_successor_graph_finalizes": 1,
        "test_matching_digest_acknowledged_successor_substitution_refuses_before_retirement": 2,
        "test_allocated_role_ack_reuses_actual_receipt_and_rejects_conflicts": 1,
        "test_actual_recovery_pending_is_fresh_inert_and_idempotent": 1,
        "test_actual_graph_producer_reuses_acknowledged_role_ids_and_preserves_parent": 1,
        "test_current_readers_follow_only_selected_ready_graph_and_keep_parent_bytes": 1,
        "test_captured_public_core_tool_data_stages_inert_rows_and_graph": 1,
        "test_generation_one_blank_home_requires_selected_relation_and_isolated_admission_stays_pinned": 1,
        "test_selected_graph_rechecks_original_home_and_definition_pins": 2,
        "test_concurrent_allocated_role_producers_share_one_stored_receipt": 1,
        "test_recovery_staging_refuses_pending_operation_join_substitution": 2,
        "test_selected_proof_rechecks_decoded_bytes_and_complete_receipts_under_root": 3,
        "test_same_plugin_pin_with_changed_current_tool_schema_cannot_stage": 1,
        "test_selected_generation_one_shell_metadata_and_resource_reads_keep_actual_proof": 2,
        "test_selected_shell_resource_recheck_refuses_missing_or_changed_proof": 3,
        "test_ordinary_shell_metadata_retains_no_recovery_proof": 1,
        "test_recovery_predecessor_reads_only_current_protected_selection": 1,
        "test_actual_sdk_receipt_is_acknowledged_without_selecting_wait": 1,
        "test_authenticated_interaction_composes_known_allocation_and_fresh_wait": 2,
        "test_acknowledged_tool_recovery_retires_only_never_dispatched_history": 1,
        "test_authenticated_recovery_read_refuses_credentials_refs_and_expired_scope": 1,
        "test_recovery_interaction_recovers_exact_durable_ack_without_allocation": 3,
        "test_recovery_unavailable_sdk_stays_ready_without_wait_or_dispatch": 1,
        "test_recovery_cancel_stops_same_child_without_handshake_authority": 8,
        "test_recovery_terminal_denial_revokes_without_grant_or_handshake": 5,
        "test_recovery_install_cancel_cas_keeps_same_child_revoked": 2,
        "test_recovery_discarded_cancel_ack_retries_after_revocation_and_resource_gc": 1,
        "test_recovery_running_cancel_acceptance_waits_for_actual_terminal_observation": 1,
        "test_recovery_cancel_retained_history_refuses_substitution": 5,
        "test_recovery_cancel_preparation_cannot_freeze_an_unrevoked_handshake": 1,
        "test_recovery_cancel_retains_same_child_after_late_allocation_settlement": 4,
        "test_actual_ordinary_cancel_keeps_original_proof_path": 1,
        "test_recovery_denial_keeps_exact_request_pending_owner": 4,
        "test_recovery_sealed_stop_rechecks_retained_child_proof": 2,
        "test_recovery_cancel_ignores_unrelated_late_acknowledged_artifact": 1,
        "test_recovery_denial_preserves_existing_decision_idempotency": 1,
    },
}
JUNIT = "builder-confirmed-recovery.xml"
code = pytest.main(
    [
        "api/tests/integration_tests/services/dify_builder/test_agent_recovery_postgres.py",
        "api/tests/integration_tests/services/dify_builder/test_confirmed_snapshot_owner.py",
        "-p",
        "no:benchmark",
        "--no-cov",
        "-vv",
        "-rA",
        "--tb=long",
        f"--junitxml={JUNIT}",
    ]
)
problems = []
identities = set()
actual = {module: Counter() for module in EXPECTED}
if not Path(JUNIT).is_file():
    problems.append("recovery JUnit report missing")
else:
    for case in ElementTree.parse(JUNIT).getroot().iter("testcase"):
        classname, name = case.get("classname") or "", case.get("name") or ""
        identity = (classname, name)
        if identity in identities:
            problems.append(f"duplicate recovery case {classname}::{name}")
        identities.add(identity)
        module = classname.removeprefix("api.")
        if module not in EXPECTED:
            problems.append(f"unexpected recovery module {classname}::{name}")
        else:
            actual[module][name.split("[", 1)[0]] += 1
        if any(case.find(tag) is not None for tag in ("failure", "error", "skipped")):
            problems.append(f"nonpassing recovery case {classname}::{name}")
for module, functions in EXPECTED.items():
    print(f"COLLECTED {module}: {sum(actual[module].values())} cases", flush=True)
    if dict(actual[module]) != functions:
        problems.append(f"recovery case inventory mismatch {module}: {dict(actual[module])!r}")
for problem in problems:
    print(f"COMPLETENESS {problem}", flush=True)
raise SystemExit(int(code) or (1 if problems else 0))

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import SecretStr

from benchmarks.staging_public_physical_cleanup import (
    _CAPTURE_TARGETS_SCRIPT,
    _parse_private_probe_json_object,
    _RECOVER_ALLOCATIONS_SCRIPT,
    StagingVendorRemainingSample,
    recover_unjournaled_staging_public_allocations,
    reconcile_staging_public_resources,
    validate_private_e2b_target_manifest,
)


class _Clock:
    def __init__(self) -> None:
        self.value = 0.0

    def monotonic(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += seconds


def _vendor_probe(
    clock: _Clock,
    remaining: list[int] | None = None,
):
    values = iter(remaining or [0, 0, 0])
    last = 0

    def sample() -> StagingVendorRemainingSample:
        nonlocal last
        last = next(values, last)
        return StagingVendorRemainingSample(
            timestamp=datetime(2026, 8, 13, tzinfo=timezone.utc) + timedelta(seconds=clock.value),
            target_remaining=last,
        )

    return sample


def _journal(path: Path, count: int) -> None:
    _journal_indices(path, range(count))


def _journal_indices(path: Path, indices) -> None:
    path.write_text(
        "".join(
            json.dumps(
                {"event": "allocated", "worker_index": index, "conversation_id": f"conversation-{index}"}
            )
            + "\n"
            for index in indices
        )
    )
    path.chmod(0o600)


def _runner(calls, *, shared_workspace: bool = False):
    def run(argv, stdin):
        calls.append((list(argv), stdin))
        if "get" in argv and "pods" in argv:
            return json.dumps(
                {
                    "items": [
                        {
                            "metadata": {"name": "api-ready"},
                            "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                        }
                    ]
                }
            )
        assert stdin is not None
        payload = json.loads(stdin)
        script = argv[-1]
        if "capture-targets" in script:
            return json.dumps(
                {
                    "targets": [
                        {
                            "conversation_id": conversation_id,
                            "workspace_id": "workspace-shared" if shared_workspace else f"workspace-{index}",
                            "binding_id": f"binding-{index}",
                            "backend_workspace_ref": f"sandbox-{index}",
                            "backend_binding_ref": f"sandbox-{index}",
                        }
                        for index, conversation_id in enumerate(payload["conversation_ids"])
                    ]
                }
            )
        assert "count-targets" in script
        return json.dumps({"conversations": 0, "workspaces": 0, "bindings": 0})

    return run


def test_parent_captures_private_targets_before_delete_and_waits_for_two_zero_checks(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    manifest = tmp_path / "private" / "cleanup.json"
    _journal(journal, 2)
    calls = []
    deletes = []
    clock = _Clock()

    result = reconcile_staging_public_resources(
        allocation_journal_path=journal,
        private_manifest_path=manifest,
        invocation_id="scaling.r1.basic.c10",
        requested_concurrency=2,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        service_api_key=SecretStr("never-serialize-this-key"),
        runner=_runner(calls),
        conversation_deleter=lambda conversation_id, end_user: deletes.append((conversation_id, end_user)) or 204,
        vendor_remaining_probe=_vendor_probe(clock),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )
    assert result.database.complete is True
    assert result.joint.complete is True
    assert result.joint.vendor_sandboxes_remaining == 0
    assert result.database.consecutive_zero_checks == 2
    assert result.database.interval_seconds == 10
    assert len(result.cleanup) == 2
    assert all(item.http_status_code == 204 for item in result.cleanup)
    assert len(deletes) == 2
    assert manifest.stat().st_mode & 0o777 == 0o600
    private = manifest.read_text()
    assert "conversation-0" in private
    assert "sandbox-1" in private
    assert all("conversation-0" not in " ".join(argv) for argv, _stdin in calls)
    assert "never-serialize-this-key" not in result.database.model_dump_json()


def test_db_and_vendor_zero_windows_are_not_synthesized_when_they_do_not_overlap(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    _journal(journal, 1)
    clock = _Clock()
    database_remaining = iter([0, 0, 0, 1, 1, 1])
    base_runner = _runner([])

    def runner(argv, stdin):
        if "count-targets" not in argv[-1]:
            return base_runner(argv, stdin)
        remaining = next(database_remaining, 1)
        return json.dumps(
            {
                "conversations": remaining,
                "workspaces": remaining,
                "bindings": remaining,
            }
        )

    result = reconcile_staging_public_resources(
        allocation_journal_path=journal,
        private_manifest_path=tmp_path / "private" / "cleanup.json",
        invocation_id="run",
        requested_concurrency=1,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        service_api_key=SecretStr("key"),
        runner=runner,
        conversation_deleter=lambda _conversation_id, _end_user: 204,
        vendor_remaining_probe=_vendor_probe(clock, [1, 1, 1, 0, 0, 0]),
        cleanup_timeout_seconds=25,
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.joint.complete is False
    assert result.joint.consecutive_zero_checks == 0
    assert result.joint.errors == [
        "database Agent resources and Vendor Sandboxes did not jointly remain zero for two checks ten seconds apart"
    ]


def test_cleanup_rejects_shared_workspace_ownership(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    _journal(journal, 2)
    with pytest.raises(RuntimeError, match="shared"):
        clock = _Clock()
        reconcile_staging_public_resources(
            allocation_journal_path=journal,
            private_manifest_path=tmp_path / "cleanup.json",
            invocation_id="run",
            requested_concurrency=2,
            service_api_base_url="https://api-staging.dify.dev/v1/",
            service_api_key=SecretStr("key"),
            runner=_runner([], shared_workspace=True),
            conversation_deleter=lambda _conversation_id, _end_user: 204,
            vendor_remaining_probe=_vendor_probe(clock),
        )


def test_capture_requires_an_exact_one_to_one_conversation_mapping(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    _journal(journal, 2)

    def duplicate_first_conversation(argv, stdin):
        if "get" in argv and "pods" in argv:
            return _runner([])(argv, stdin)
        assert stdin is not None
        payload = json.loads(stdin)
        if "capture-targets" in argv[-1]:
            return json.dumps(
                {
                    "targets": [
                        {
                            "conversation_id": payload["conversation_ids"][0],
                            "workspace_id": f"workspace-{index}",
                            "binding_id": f"binding-{index}",
                            "backend_workspace_ref": f"sandbox-{index}",
                            "backend_binding_ref": f"sandbox-{index}",
                        }
                        for index in range(2)
                    ]
                }
            )
        return json.dumps({"conversations": 0, "workspaces": 0, "bindings": 0})

    with pytest.raises(RuntimeError, match="not every benchmark Conversation"):
        clock = _Clock()
        reconcile_staging_public_resources(
            allocation_journal_path=journal,
            private_manifest_path=tmp_path / "cleanup.json",
            invocation_id="run",
            requested_concurrency=2,
            service_api_base_url="https://api-staging.dify.dev/v1/",
            service_api_key=SecretStr("key"),
            runner=duplicate_first_conversation,
            conversation_deleter=lambda _conversation_id, _end_user: 204,
            vendor_remaining_probe=_vendor_probe(clock),
        )


def test_partial_allocations_capture_and_delete_only_allocated_users(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    manifest = tmp_path / "private" / "cleanup.json"
    _journal_indices(journal, (1, 3))
    calls = []
    deletes = []
    clock = _Clock()

    result = reconcile_staging_public_resources(
        allocation_journal_path=journal,
        private_manifest_path=manifest,
        invocation_id="scaling.r1.basic.c4",
        requested_concurrency=4,
        expected_allocations=2,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        service_api_key=SecretStr("key"),
        runner=_runner(calls),
        conversation_deleter=lambda conversation_id, end_user: deletes.append((conversation_id, end_user)) or 204,
        vendor_remaining_probe=_vendor_probe(clock),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.database.target_conversations == 2
    assert [item.worker_index for item in result.cleanup] == [1, 3]
    assert deletes == [
        ("conversation-1", "dify-bench-scaling.r1.basic.c4.b1.w1"),
        ("conversation-3", "dify-bench-scaling.r1.basic.c4.b1.w3"),
    ]
    payload = json.loads(manifest.read_text())
    assert [row["worker_index"] for row in payload["targets"]] == [1, 3]


def test_zero_allocations_produce_a_secure_empty_manifest_without_a_db_probe(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    manifest = tmp_path / "private" / "cleanup.json"
    _journal_indices(journal, ())
    callbacks: list[Path] = []
    clock = _Clock()

    result = reconcile_staging_public_resources(
        allocation_journal_path=journal,
        private_manifest_path=manifest,
        invocation_id="scaling.r1.basic.c4",
        requested_concurrency=4,
        expected_allocations=0,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        service_api_key=SecretStr("key"),
        runner=lambda _argv, _stdin: pytest.fail("DB must not be queried for zero allocations"),
        conversation_deleter=lambda _conversation_id, _end_user: pytest.fail("nothing should be deleted"),
        before_delete=callbacks.append,
        vendor_remaining_probe=_vendor_probe(clock),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert result.cleanup == ()
    assert result.database.complete is True
    assert result.joint.complete is True
    assert result.database.target_conversations == 0
    assert callbacks == [manifest]
    assert manifest.stat().st_mode & 0o777 == 0o600
    assert json.loads(manifest.read_text()) == {"allocations": [], "targets": []}


def test_api_probe_uses_the_f5_conversation_owner_contract() -> None:
    compile(_CAPTURE_TARGETS_SCRIPT, "<staging-cleanup-probe>", "exec")
    for required_expression in (
        "Conversation.agent_workspace_binding_id",
        "AgentWorkspace.owner_type==AgentWorkspaceOwnerType.CONVERSATION",
        "AgentWorkspace.owner_id==Conversation.id",
        "AgentWorkspace.owner_scope_key=='root'",
        "AgentWorkspaceBinding.tenant_id==App.tenant_id",
        "AgentWorkspaceBinding.app_id==Conversation.app_id",
    ):
        assert required_expression in _CAPTURE_TARGETS_SCRIPT


def test_parent_recovers_unjournaled_cold_post_allocation_in_exact_worker_scope(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    recovery_manifest = tmp_path / "private" / "allocation-recovery.json"
    _journal_indices(journal, (0,))
    calls = []

    def runner(argv, stdin):
        calls.append((list(argv), stdin))
        if "get" in argv and "pods" in argv:
            return _runner([])(argv, stdin)
        assert stdin is not None
        payload = json.loads(stdin)
        assert payload["tenant_id"] == "benchmark-tenant"
        assert payload["agent_id"] == "benchmark-agent"
        return json.dumps(
            {
                "allocations": [
                    {
                        "conversation_id": f"conversation-{scope['worker_index']}",
                        "end_user": scope["end_user"],
                    }
                    for scope in payload["scopes"]
                ]
            }
        )

    result = recover_unjournaled_staging_public_allocations(
        allocation_journal_path=journal,
        private_manifest_path=recovery_manifest,
        invocation_id="scaling.r1.basic.c2",
        requested_concurrency=2,
        benchmark_tenant_id="benchmark-tenant",
        benchmark_agent_id="benchmark-agent",
        runner=runner,
    )

    assert result.allocated_count == 2
    assert result.recovered_count == 1
    assert recovery_manifest.stat().st_mode & 0o777 == 0o600
    records = [json.loads(line) for line in journal.read_text().splitlines()]
    assert records[-1] == {
        "conversation_id": "conversation-1",
        "event": "allocated",
        "worker_index": 1,
    }
    assert all("conversation-1" not in " ".join(argv) for argv, _stdin in calls)


def test_allocation_recovery_accepts_api_initialization_output_before_final_json(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    recovery_manifest = tmp_path / "private" / "allocation-recovery.json"
    _journal_indices(journal, (0,))

    def runner(argv, stdin):
        if "get" in argv and "pods" in argv:
            return _runner([])(argv, stdin)
        assert stdin is not None
        scope = json.loads(stdin)["scopes"][0]
        return "framework initialization diagnostic\n" + json.dumps(
            {"allocations": [{"conversation_id": "conversation-0", "end_user": scope["end_user"]}]}
        )

    result = recover_unjournaled_staging_public_allocations(
        allocation_journal_path=journal,
        private_manifest_path=recovery_manifest,
        invocation_id="scaling.r1.basic.c1",
        requested_concurrency=1,
        benchmark_tenant_id="benchmark-tenant",
        benchmark_agent_id="benchmark-agent",
        runner=runner,
    )

    assert result.allocated_count == 1
    assert result.recovered_count == 0


def test_private_probe_parser_rejects_output_after_its_final_json_object() -> None:
    with pytest.raises(RuntimeError, match="invalid response"):
        _parse_private_probe_json_object('{"allocations":[]}\nunexpected trailing output')


def test_allocation_recovery_retains_private_evidence_and_fails_on_ambiguous_owner(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    recovery_manifest = tmp_path / "private" / "allocation-recovery.json"
    _journal_indices(journal, ())

    def runner(argv, stdin):
        if "get" in argv and "pods" in argv:
            return _runner([])(argv, stdin)
        assert stdin is not None
        end_user = json.loads(stdin)["scopes"][0]["end_user"]
        return json.dumps(
            {
                "allocations": [
                    {"conversation_id": "conversation-a", "end_user": end_user},
                    {"conversation_id": "conversation-b", "end_user": end_user},
                ]
            }
        )

    with pytest.raises(RuntimeError, match="ambiguous"):
        recover_unjournaled_staging_public_allocations(
            allocation_journal_path=journal,
            private_manifest_path=recovery_manifest,
            invocation_id="scaling.r1.basic.c1",
            requested_concurrency=1,
            benchmark_tenant_id="benchmark-tenant",
            benchmark_agent_id="benchmark-agent",
            runner=runner,
        )

    assert recovery_manifest.is_file()
    assert recovery_manifest.stat().st_mode & 0o777 == 0o600
    assert "conversation-a" in recovery_manifest.read_text()
    assert journal.read_text() == ""


def test_allocation_recovery_rejects_a_conversation_outside_requested_end_users(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    recovery_manifest = tmp_path / "private" / "allocation-recovery.json"
    _journal_indices(journal, ())

    def runner(argv, stdin):
        if "get" in argv and "pods" in argv:
            return _runner([])(argv, stdin)
        return json.dumps(
            {
                "allocations": [
                    {
                        "conversation_id": "unrelated-conversation",
                        "end_user": "unrelated-end-user",
                    }
                ]
            }
        )

    with pytest.raises(RuntimeError, match="escaped the requested EndUser scope"):
        recover_unjournaled_staging_public_allocations(
            allocation_journal_path=journal,
            private_manifest_path=recovery_manifest,
            invocation_id="scaling.r1.basic.c1",
            requested_concurrency=1,
            benchmark_tenant_id="benchmark-tenant",
            benchmark_agent_id="benchmark-agent",
            runner=runner,
        )

    assert recovery_manifest.is_file()
    assert "unrelated-conversation" in recovery_manifest.read_text()
    assert journal.read_text() == ""


def test_allocation_recovery_probe_is_tenant_agent_and_end_user_scoped() -> None:
    compile(_RECOVER_ALLOCATIONS_SCRIPT, "<staging-allocation-recovery-probe>", "exec")
    for required_expression in (
        "Agent.id==p['agent_id']",
        "Agent.tenant_id==p['tenant_id']",
        "Agent.app_id==App.id",
        "App.tenant_id==p['tenant_id']",
        "Conversation.from_source==ConversationFromSource.API",
        "Conversation.invoke_from==InvokeFrom.SERVICE_API",
        "EndUser.tenant_id==p['tenant_id']",
        "EndUser.app_id==App.id",
        "EndUser.type==EndUserType.SERVICE_API",
        "EndUser.session_id.in_(sessions)",
    ):
        assert required_expression in _RECOVER_ALLOCATIONS_SCRIPT


def test_deleted_journal_record_fails_before_db_probe(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    _journal(journal, 1)
    with journal.open("a") as stream:
        stream.write(json.dumps({"event": "deleted", "worker_index": 0, "conversation_id": "conversation-0"}) + "\n")
    with pytest.raises(RuntimeError, match="before private resource capture"):
        clock = _Clock()
        reconcile_staging_public_resources(
            allocation_journal_path=journal,
            private_manifest_path=tmp_path / "cleanup.json",
            invocation_id="run",
            requested_concurrency=1,
            service_api_base_url="https://api-staging.dify.dev/v1/",
            service_api_key=SecretStr("key"),
            runner=lambda _argv, _stdin: pytest.fail("DB must not be queried"),
            conversation_deleter=lambda _conversation_id, _end_user: 204,
            vendor_remaining_probe=_vendor_probe(clock),
        )


def test_private_database_and_vendor_manifests_must_match(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    vendor = tmp_path / "vendor.jsonl"
    database.write_text(
        json.dumps(
            {
                "targets": [
                    {
                        "backend_binding_ref": "sandbox-0",
                        "workspace_id": "workspace-0",
                        "binding_id": "binding-0",
                    }
                ]
            }
        )
    )
    database.chmod(0o600)
    vendor.write_text(
        json.dumps(
            {
                "sandbox_id": "sandbox-0",
                "workspace_id": "workspace-0",
                "binding_id": "binding-0",
            }
        )
        + "\n"
    )
    vendor.chmod(0o600)
    validate_private_e2b_target_manifest(
        database_manifest_path=database,
        e2b_manifest_path=vendor,
        expected_targets=1,
    )
    vendor.write_text(
        json.dumps(
            {
                "sandbox_id": "different",
                "workspace_id": "workspace-0",
                "binding_id": "binding-0",
            }
        )
        + "\n"
    )
    vendor.chmod(0o600)
    with pytest.raises(RuntimeError, match="did not match"):
        validate_private_e2b_target_manifest(
            database_manifest_path=database,
            e2b_manifest_path=vendor,
            expected_targets=1,
        )


def test_private_manifest_inputs_reject_broad_permissions_and_symlinks(tmp_path: Path) -> None:
    database = tmp_path / "database.json"
    vendor = tmp_path / "vendor.jsonl"
    database.write_text('{"targets":[]}')
    database.chmod(0o644)
    vendor.write_text("")
    vendor.chmod(0o600)

    with pytest.raises(RuntimeError, match="permissions were too broad"):
        validate_private_e2b_target_manifest(
            database_manifest_path=database,
            e2b_manifest_path=vendor,
            expected_targets=1,
        )

    database.chmod(0o600)
    link = tmp_path / "vendor-link.jsonl"
    link.symlink_to(vendor)
    with pytest.raises(RuntimeError, match="not a regular file"):
        validate_private_e2b_target_manifest(
            database_manifest_path=database,
            e2b_manifest_path=link,
            expected_targets=1,
        )


def test_before_delete_failure_still_deletes_conversations_but_invalidates_evidence(tmp_path: Path) -> None:
    journal = tmp_path / "allocations.jsonl"
    _journal(journal, 1)
    deletes: list[str] = []

    clock = _Clock()
    result = reconcile_staging_public_resources(
        allocation_journal_path=journal,
        private_manifest_path=tmp_path / "private" / "cleanup.json",
        invocation_id="run",
        requested_concurrency=1,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        service_api_key=SecretStr("key"),
        runner=_runner([]),
        conversation_deleter=lambda conversation_id, _end_user: deletes.append(conversation_id) or 204,
        before_delete=lambda _path: (_ for _ in ()).throw(RuntimeError("observer manifest mismatch")),
        vendor_remaining_probe=_vendor_probe(clock),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
    )

    assert deletes == ["conversation-0"]
    assert result.cleanup[0].http_status_code == 204
    assert result.database.complete is False
    assert result.database.errors == ["pre-delete Vendor ownership reconciliation failed"]

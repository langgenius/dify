"""Opt-in integration contracts for final Local and E2B working environments."""

from __future__ import annotations

import os
import shlex
import sys
import uuid

import pytest

from dify_agent.runtime_backend import (
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
)
from dify_agent.runtime_backend.e2b import E2BExecutionBindingBackend, E2BHomeSnapshotBackend, E2BSDKControlPlane
from dify_agent.runtime_backend.e2b_s3 import (
    E2BHomeSnapshotCLI,
    E2BS3ExecutionBindingBackend,
    E2BS3HomeSnapshotBackend,
    OpenDALHomeArchiveStore,
)
from dify_agent.agent_stub.server.tokens.home_snapshot import HomeSnapshotTransferTokenCodec
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend
from dify_agent.runtime_backend.shellctl import CONTROL_COMMAND_OUTPUT_LIMIT, execute_complete_with_commands

pytestmark = pytest.mark.integration


def _required_env(name: str, purpose: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        pytest.skip(f"set {name} to run the {purpose} integration contract")
    return value


@pytest.mark.anyio
async def test_local_two_agents_share_workspace_but_not_home() -> None:
    endpoint = _required_env("DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT", "real Local shellctl")
    token = os.environ.get("DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN", "")
    marker = uuid.uuid4().hex
    bindings = LocalExecutionBindingBackend(endpoint=endpoint, auth_token=token)
    allocations = []
    active_leases = []
    try:
        first = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="agent-a",
                binding_id=f"binding-a-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=None,
                home_snapshot_ref=None,
            )
        )
        allocations.append(first)
        first_lease = await bindings.acquire(first.binding_ref)
        active_leases.append(first_lease)
        await first_lease.files.upload(
            content=b"shared", remote_path="shared.txt", cwd=first_lease.layout.workspace_dir
        )
        await bindings.release(first_lease)
        active_leases.remove(first_lease)

        second = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="agent-b",
                binding_id=f"binding-b-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=first.workspace_ref,
                home_snapshot_ref=None,
            )
        )
        allocations.append(second)
        second_lease = await bindings.acquire(second.binding_ref)
        active_leases.append(second_lease)
        shared = await second_lease.files.read_bytes(path="shared.txt", max_bytes=1024)
        assert shared.content == b"shared"
        assert second_lease.layout.home_dir != first_lease.layout.home_dir
        assert second_lease.layout.workspace_dir == first_lease.layout.workspace_dir
        await bindings.release(second_lease)
        active_leases.remove(second_lease)
    finally:
        primary_error = sys.exc_info()[0] is not None
        cleanup_errors: list[BaseException] = []
        for lease in active_leases:
            try:
                await bindings.release(lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
        for index, allocation in enumerate(allocations):
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(
                        binding_ref=allocation.binding_ref,
                        workspace_ref=allocation.workspace_ref if index == len(allocations) - 1 else None,
                        destroy_workspace=index == len(allocations) - 1,
                    )
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]


@pytest.mark.anyio
async def test_e2b_binding_checkpoint_and_collection() -> None:
    api_key = _required_env("DIFY_AGENT_TEST_E2B_API_KEY", "real E2B")
    template = os.environ.get(
        "DIFY_AGENT_TEST_E2B_TEMPLATE",
        "difys-default-team/dify-agent-local-sandbox",
    )
    marker = uuid.uuid4().hex
    control = E2BSDKControlPlane(api_key=api_key)
    snapshots = E2BHomeSnapshotBackend(control_plane=control)
    bindings = E2BExecutionBindingBackend(control_plane=control, template=template, active_timeout_seconds=3600)
    checkpoint_ref: str | None = None
    allocation = None
    checkpoint_allocation = None
    lease = None
    checkpoint_lease = None
    try:
        allocation = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=marker,
                workspace_id=marker,
                existing_workspace_ref=None,
                home_snapshot_ref=None,
            )
        )
        lease = await bindings.acquire(allocation.binding_ref)
        await lease.files.upload(content=b"e2b", remote_path="probe.txt", cwd=lease.layout.workspace_dir)
        await lease.files.upload(content=b"checkpoint-home", remote_path=".checkpoint-probe", cwd=lease.layout.home_dir)
        assert (await lease.files.read_bytes(path="probe.txt", max_bytes=1024)).content == b"e2b"
        checkpoint_ref = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=f"checkpoint-{marker}",
            ),
            source=lease,
        )
        await bindings.release(lease)
        lease = None

        checkpoint_allocation = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=f"checkpoint-{marker}",
                workspace_id=f"checkpoint-{marker}",
                existing_workspace_ref=None,
                home_snapshot_ref=checkpoint_ref,
            )
        )
        checkpoint_lease = await bindings.acquire(checkpoint_allocation.binding_ref)
        restored = await checkpoint_lease.files.read_bytes(path="~/.checkpoint-probe", max_bytes=1024)
        assert restored.content == b"checkpoint-home"
        await bindings.release(checkpoint_lease)
        checkpoint_lease = None
    finally:
        primary_error = sys.exc_info()[0] is not None
        cleanup_errors: list[BaseException] = []
        if lease is not None:
            try:
                await bindings.release(lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if checkpoint_lease is not None:
            try:
                await bindings.release(checkpoint_lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if checkpoint_allocation is not None:
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(
                        binding_ref=checkpoint_allocation.binding_ref,
                        workspace_ref=checkpoint_allocation.workspace_ref,
                        destroy_workspace=True,
                    )
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        if allocation is not None:
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(
                        binding_ref=allocation.binding_ref,
                        workspace_ref=allocation.workspace_ref,
                        destroy_workspace=True,
                    )
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        if checkpoint_ref is not None:
            try:
                await snapshots.delete(checkpoint_ref)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]


@pytest.mark.anyio
async def test_e2b_s3_shared_workspace_checkpoint_and_collection() -> None:
    api_key = _required_env("DIFY_AGENT_TEST_E2B_API_KEY", "real E2B + S3")
    storage_uri = _required_env("DIFY_AGENT_TEST_E2B_S3_URI", "real E2B + OpenDAL storage")
    stub_url = _required_env("DIFY_AGENT_TEST_E2B_S3_STUB_API_BASE_URL", "public Home Snapshot gateway")
    server_secret = _required_env("DIFY_AGENT_TEST_SERVER_SECRET_KEY", "Home Snapshot transfer JWE")
    template = os.environ.get(
        "DIFY_AGENT_TEST_E2B_TEMPLATE",
        "difys-default-team/dify-agent-local-sandbox",
    )
    marker = uuid.uuid4().hex
    control = E2BSDKControlPlane(api_key=api_key)
    store = OpenDALHomeArchiveStore.create_from_uri(storage_uri)
    lifecycle_cli = E2BHomeSnapshotCLI(
        token_codec=HomeSnapshotTransferTokenCodec.from_server_secret(server_secret),
        agent_stub_api_base_url=stub_url,
        shellctl_auth_token=os.environ.get("DIFY_AGENT_TEST_E2B_SHELLCTL_AUTH_TOKEN", ""),
        shellctl_port=int(os.environ.get("DIFY_AGENT_TEST_E2B_SHELLCTL_PORT", "5004")),
    )
    snapshots = E2BS3HomeSnapshotBackend(
        control_plane=control,
        archive_store=store,
        lifecycle_cli=lifecycle_cli,
        template=template,
        active_timeout_seconds=3600,
    )
    bindings = E2BS3ExecutionBindingBackend(
        control_plane=control,
        lifecycle_cli=lifecycle_cli,
        template=template,
        active_timeout_seconds=3600,
        shellctl_auth_token=os.environ.get("DIFY_AGENT_TEST_E2B_SHELLCTL_AUTH_TOKEN", ""),
        shellctl_port=int(os.environ.get("DIFY_AGENT_TEST_E2B_SHELLCTL_PORT", "5004")),
    )
    allocations = []
    active_leases = []
    snapshot_refs: list[str] = []
    try:
        baseline_ref = await snapshots.initialize(
            HomeSnapshotCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=f"baseline-{marker}",
            )
        )
        snapshot_refs.append(baseline_ref)
        first = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=f"binding-a-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=None,
                home_snapshot_ref=baseline_ref,
            )
        )
        allocations.append(first)
        first_lease = await bindings.acquire(first.binding_ref)
        active_leases.append(first_lease)
        await first_lease.files.upload(
            content=b"shared",
            remote_path="shared.txt",
            cwd=first_lease.layout.workspace_dir,
        )
        await first_lease.files.upload(
            content=b"checkpoint-home",
            remote_path=".checkpoint-probe",
            cwd=first_lease.layout.home_dir,
        )

        second = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=f"binding-b-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=first.workspace_ref,
                home_snapshot_ref=baseline_ref,
            )
        )
        allocations.append(second)
        second_lease = await bindings.acquire(second.binding_ref)
        active_leases.append(second_lease)
        assert (await second_lease.files.read_bytes(path="shared.txt", max_bytes=1024)).content == b"shared"
        assert second_lease.layout.home_dir != first_lease.layout.home_dir
        sibling_read = await execute_complete_with_commands(
            second_lease.commands,
            f"cat {shlex.quote(f'{first_lease.layout.home_dir}/.checkpoint-probe')}",
            cwd=None,
            env={"HOME": "/tmp/ignored"},
            timeout=10.0,
            max_output_bytes=CONTROL_COMMAND_OUTPUT_LIMIT,
        )
        assert sibling_read.done and sibling_read.exit_code not in (None, 0)
        await bindings.release(second_lease)
        active_leases.remove(second_lease)

        checkpoint_ref = await snapshots.create_from_runtime(
            spec=HomeSnapshotCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=f"checkpoint-{marker}",
            ),
            source=first_lease,
        )
        snapshot_refs.append(checkpoint_ref)
        third = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=f"binding-c-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=first.workspace_ref,
                home_snapshot_ref=checkpoint_ref,
            )
        )
        allocations.append(third)
        third_lease = await bindings.acquire(third.binding_ref)
        active_leases.append(third_lease)
        restored = await third_lease.files.read_bytes(path="~/.checkpoint-probe", max_bytes=1024)
        assert restored.content == b"checkpoint-home"
        assert (await third_lease.files.read_bytes(path="shared.txt", max_bytes=1024)).content == b"shared"

        await bindings.destroy_binding(
            ExecutionBindingDestroySpec(binding_ref=second.binding_ref, destroy_workspace=False)
        )
        allocations.remove(second)
    finally:
        primary_error = sys.exc_info()[0] is not None
        cleanup_errors: list[BaseException] = []
        for lease in active_leases:
            try:
                await bindings.release(lease)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if allocations:
            workspace_owner = allocations.pop(0)
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(
                        binding_ref=workspace_owner.binding_ref,
                        workspace_ref=workspace_owner.workspace_ref,
                        destroy_workspace=True,
                    )
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        for allocation in allocations:
            try:
                await bindings.destroy_binding(
                    ExecutionBindingDestroySpec(binding_ref=allocation.binding_ref, destroy_workspace=False)
                )
            except BaseException as exc:
                cleanup_errors.append(exc)
        for snapshot_ref in snapshot_refs:
            try:
                await snapshots.delete(snapshot_ref)
            except BaseException as exc:
                cleanup_errors.append(exc)
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]

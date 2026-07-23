"""Opt-in integration contracts for final Local and E2B working environments."""

from __future__ import annotations

import os
import sys
import uuid

import pytest

from dify_agent.runtime_backend import (
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    InitializeHomeSnapshotSpec,
)
from dify_agent.runtime_backend.e2b import E2BExecutionBindingBackend, E2BHomeSnapshotBackend, E2BSDKControlPlane
from dify_agent.runtime_backend.local import LocalExecutionBindingBackend, LocalHomeSnapshotBackend

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
    snapshots = LocalHomeSnapshotBackend(endpoint=endpoint, auth_token=token)
    bindings = LocalExecutionBindingBackend(endpoint=endpoint, auth_token=token)
    snapshot_ref: str | None = None
    allocations = []
    active_leases = []
    try:
        snapshot_ref = await snapshots.initialize(
            InitializeHomeSnapshotSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=marker,
            )
        )
        first = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="agent-a",
                binding_id=f"binding-a-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=None,
                home_snapshot_ref=snapshot_ref,
            )
        )
        allocations.append(first)
        first_lease = await bindings.acquire(first.binding_ref)
        active_leases.append(first_lease)
        await first_lease.files.upload(content=b"shared", remote_path="shared.txt", cwd=first_lease.layout.workspace_dir)
        await bindings.release(first_lease)
        active_leases.remove(first_lease)

        second = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="agent-b",
                binding_id=f"binding-b-{marker}",
                workspace_id=f"workspace-{marker}",
                existing_workspace_ref=first.workspace_ref,
                home_snapshot_ref=snapshot_ref,
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
        if snapshot_ref is not None:
            try:
                await snapshots.delete(snapshot_ref)
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
    snapshots = E2BHomeSnapshotBackend(control_plane=control, template=template, active_timeout_seconds=3600)
    bindings = E2BExecutionBindingBackend(control_plane=control, active_timeout_seconds=3600)
    snapshot_ref: str | None = None
    checkpoint_ref: str | None = None
    allocation = None
    checkpoint_allocation = None
    lease = None
    checkpoint_lease = None
    try:
        snapshot_ref = await snapshots.initialize(
            InitializeHomeSnapshotSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                home_snapshot_id=marker,
            )
        )
        allocation = await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="integration-tenant",
                agent_id="integration-agent",
                binding_id=marker,
                workspace_id=marker,
                existing_workspace_ref=None,
                home_snapshot_ref=snapshot_ref,
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
        for ref in (checkpoint_ref, snapshot_ref):
            if ref is not None:
                try:
                    await snapshots.delete(ref)
                except BaseException as exc:
                    cleanup_errors.append(exc)
        if cleanup_errors and not primary_error:
            raise cleanup_errors[0]

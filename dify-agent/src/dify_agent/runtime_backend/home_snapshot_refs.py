"""Canonical opaque refs used by the e2b_s3 Home Snapshot backend."""

from __future__ import annotations

import re

from dify_agent.runtime_backend.protocols import HomeSnapshotCreateSpec

_SAFE_REF_SEGMENT = re.compile(r"^[A-Za-z0-9._-]+$")
_SNAPSHOT_PREFIX = "home-snapshots"
_SNAPSHOT_SUFFIX = ".tar.zst"


def validate_ref_segment(value: str) -> str:
    if value in {"", ".", ".."} or "\\" in value or _SAFE_REF_SEGMENT.fullmatch(value) is None:
        raise ValueError("runtime backend ref must be a safe path segment")
    return value


def build_home_snapshot_ref(spec: HomeSnapshotCreateSpec) -> str:
    return "/".join(
        (
            _SNAPSHOT_PREFIX,
            validate_ref_segment(spec.tenant_id),
            validate_ref_segment(spec.agent_id),
            f"{validate_ref_segment(spec.home_snapshot_id)}{_SNAPSHOT_SUFFIX}",
        )
    )


def validate_home_snapshot_ref(snapshot_ref: str) -> str:
    if snapshot_ref.startswith("/") or "\\" in snapshot_ref:
        raise ValueError("Home Snapshot ref is invalid")
    parts = snapshot_ref.split("/")
    if len(parts) != 4 or parts[0] != _SNAPSHOT_PREFIX:
        raise ValueError("Home Snapshot ref is invalid")
    tenant_id = validate_ref_segment(parts[1])
    agent_id = validate_ref_segment(parts[2])
    filename = parts[3]
    if not filename.endswith(_SNAPSHOT_SUFFIX):
        raise ValueError("Home Snapshot ref is invalid")
    snapshot_id = validate_ref_segment(filename.removesuffix(_SNAPSHOT_SUFFIX))
    return f"{_SNAPSHOT_PREFIX}/{tenant_id}/{agent_id}/{snapshot_id}{_SNAPSHOT_SUFFIX}"


__all__ = ["build_home_snapshot_ref", "validate_home_snapshot_ref", "validate_ref_segment"]

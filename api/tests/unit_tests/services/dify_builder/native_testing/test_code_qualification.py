from collections.abc import Callable
from typing import cast

import pytest
from pydantic import JsonValue

from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.sandbox.qualification import NativeCodeCapability, NativeCodeQualification


class CapabilityOwner:
    """Declared qualification boundary whose capability checks are observed by tests."""

    def __init__(self, validate: Callable[[NativeCodeCapability], None]) -> None:
        self._validate = validate

    def validate(self, *, capability: NativeCodeCapability) -> None:
        return self._validate(capability)


class InvalidQualificationOwner:
    def validate(self, *, capability: NativeCodeCapability) -> bool:
        del capability
        return True


def capability() -> NativeCodeCapability:
    from services.dify_builder.native_testing.sandbox.qualification import (
        BOUNDS,
        NativeCodeCapability,
    )

    return NativeCodeCapability(
        bounds=tuple(sorted(BOUNDS.items())),
        deployment_ref="test-only-deployment",
        image_digest="a" * 64,
        environment_digest="b" * 64,
        python_digest="c" * 64,
        node_digest="d" * 64,
        empty_snapshot_ref="empty-test-only",
        empty_snapshot_digest="e" * 64,
        endpoint="http://code.invalid",
        auth_token="test-only-token",
        python_executable="/usr/local/bin/python3",
        node_executable="/usr/bin/node",
    )


def qualification() -> tuple[NativeCodeQualification, list[NativeCodeCapability]]:
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeQualification,
    )

    seen: list[NativeCodeCapability] = []
    owner = CapabilityOwner(seen.append)
    return NativeCodeQualification(capability=capability(), owner=owner), seen


def test_capability_dto_and_artifact_hashes_do_not_grant_authority() -> None:
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeQualification,
        NativeCodeQualificationOwner,
    )

    with pytest.raises(BuilderExecutionPolicyError):
        NativeCodeQualification(capability=capability(), owner=cast(NativeCodeQualificationOwner, None))
    with pytest.raises(BuilderExecutionPolicyError):
        NativeCodeQualification(
            capability=capability(), owner=cast(NativeCodeQualificationOwner, InvalidQualificationOwner())
        )


def test_qualification_rechecks_exact_complete_snapshot_for_each_use() -> None:
    q, seen = qualification()
    q.check()
    q.check()
    assert len(seen) == 3
    assert all(c is q.capability for c in seen)
    assert q.profile().profile_id == "builder-native-code-no-network-v1"
    assert q.profile().limits == {"calls": 16, "dispatches": 16, "cost_units": 16}
    assert "test-only-token" not in str(q.descriptor())
    assert "code.invalid" not in str(q.descriptor())


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("empty_snapshot_digest", "fake"),
        ("endpoint", "https://x/path"),
        ("endpoint", "http://secret@x"),
        ("python_executable", "python"),
        ("auth_token", ""),
    ],
)
def test_invalid_qualified_identity_refuses_before_owner(field: str, value: JsonValue) -> None:
    from services.dify_builder.native_testing.sandbox.qualification import (
        NativeCodeQualification,
    )

    cap = capability().model_copy(update={field: value})
    with pytest.raises(BuilderExecutionPolicyError):
        NativeCodeQualification(
            capability=cap,
            owner=CapabilityOwner(lambda _capability: pytest.fail("invalid capability reached owner")),
        )


def test_owner_revocation_refuses_existing_qualification() -> None:
    q, _ = qualification()
    q.owner.validate = lambda **_kw: (_ for _ in ()).throw(ValueError("private reason"))
    with pytest.raises(BuilderExecutionPolicyError) as error:
        q.check()
    assert "private reason" not in str(error.value)


def test_complete_snapshot_binds_the_fixed_deployment_limits() -> None:
    q, _ = qualification()
    assert dict(q.capability.bounds)["memory_bytes"] == 256 << 20
    assert dict(q.capability.bounds)["wall_seconds"] == 30


def raw_code(**changes: JsonValue) -> dict[str, JsonValue]:
    return {
        "type": "code",
        "version": "1",
        "title": "private title",
        "variables": [],
        "code_language": "python3",
        "code": "def main(): return {'result': 'CANARY'}",
        "outputs": {"result": {"type": "string"}},
        **changes,
    }


def test_code_descriptor_binds_config_environment_and_limits_without_payload() -> None:
    from services.dify_builder.native_testing.sandbox.qualification import (
        describe_code_resource,
    )

    q, _ = qualification()
    d = describe_code_resource(
        qualification=q,
        node_id="code",
        raw=raw_code(),
        workflow_revision="f" * 64,
        app_id="app",
        workflow_id="wf",
    )
    assert d["native_type"] == "code"
    assert d["native_version"] == "1"
    assert d["policy"]["isolated"] is True
    assert d["policy"]["egress"] is False
    assert d["policy"]["approval_scope"] == "operation"
    assert "CANARY" not in str(d)
    assert "private title" not in str(d)
    changed = describe_code_resource(
        qualification=q,
        node_id="code",
        raw=raw_code(code="different"),
        workflow_revision="f" * 64,
        app_id="app",
        workflow_id="wf",
    )
    assert changed != d


@pytest.mark.parametrize(
    "change",
    [
        {"variables": [{"variable": "x", "value_selector": ["env", "SECRET"]}]},
        {"dependencies": [{"name": "unqualified", "version": "1"}]},
        {"version": "2"},
        {"type": "http-request"},
    ],
)
def test_resource_refuses_unqualified_config_before_payload_preparation(change: dict[str, JsonValue]) -> None:
    from services.dify_builder.native_testing.sandbox.qualification import (
        describe_code_resource,
    )

    q, _ = qualification()
    with pytest.raises(BuilderExecutionPolicyError):
        describe_code_resource(
            qualification=q,
            node_id="code",
            raw=raw_code(**change),
            workflow_revision="f" * 64,
            app_id="app",
            workflow_id="wf",
        )

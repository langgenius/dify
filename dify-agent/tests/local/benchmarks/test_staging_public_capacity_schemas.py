from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from benchmarks.staging_public_capacity_schemas import (
    STAGING_PUBLIC_CAPACITY_CONCURRENCY,
    STAGING_PUBLIC_CAPACITY_MATRIX,
    STAGING_PUBLIC_CAPACITY_SCALING_MATRIX,
    StagingPublicCapacityE2BObservation,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityPointRequest,
    StagingPublicCapacityResult,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityStageResult,
)


def test_capacity_matrices_are_directional_and_replica_asymmetric() -> None:
    assert STAGING_PUBLIC_CAPACITY_CONCURRENCY == (1, 10, 20, 30, 40, 60, 80, 120, 160)
    assert STAGING_PUBLIC_CAPACITY_MATRIX == (
        ("basic", 1),
        ("basic", 10),
        ("basic", 20),
        ("basic", 30),
        ("basic", 40),
        ("basic", 60),
        ("basic", 80),
        ("basic", 120),
        ("basic", 160),
        ("shell", 1),
        ("shell", 10),
        ("shell", 20),
        ("config", 1),
        ("config", 10),
        ("config", 20),
    )
    assert len(STAGING_PUBLIC_CAPACITY_SCALING_MATRIX) == 37
    assert (1, "shell", 20) in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
    assert (2, "shell", 10) in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
    assert (4, "config", 10) in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
    assert (2, "shell", 20) not in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
    assert (4, "config", 20) not in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX


def test_capacity_request_is_dynamic_single_block_secret_free_and_strict() -> None:
    request = StagingPublicCapacityPointRequest(
        invocation_id="capacity.r4.basic.c160",
        service_api_base_url="https://api-staging.dify.dev/v1/",
        config_expected_sha256="a" * 64,
        scenario_id="basic",
        requested_concurrency=160,
        expected_backend_replicas=4,
        setup_timeout_seconds=300,
    )
    assert request.block_index == 1
    assert request.phase == "initial"
    assert request.warmup_seconds == 15
    assert request.measurement_seconds == 60
    assert request.drain_timeout_seconds == 180
    assert "api_key" not in request.model_dump_json().lower()
    with pytest.raises(ValidationError):
        StagingPublicCapacityPointRequest.model_validate({**request.model_dump(), "api_key": "secret"})
    with pytest.raises(ValidationError):
        StagingPublicCapacityPointRequest.model_validate({**request.model_dump(), "requested_concurrency": 161})


@pytest.mark.parametrize("block_index", [0, 2])
def test_capacity_request_rejects_non_single_block_indexes(block_index: int) -> None:
    with pytest.raises(ValidationError):
        StagingPublicCapacityPointRequest(
            invocation_id="capacity",
            service_api_base_url="https://api-staging.dify.dev/v1/",
            config_expected_sha256="a" * 64,
            scenario_id="basic",
            requested_concurrency=1,
            block_index=block_index,
            setup_timeout_seconds=300,
        )


def test_e2b_limit_requires_three_consecutive_one_second_samples() -> None:
    with pytest.raises(ValidationError):
        StagingPublicCapacityE2BObservation(
            running_max=20,
            running_limit_consecutive_seconds=2,
            limit_reached=True,
        )
    evidence = StagingPublicCapacityE2BObservation(
        running_max=20,
        running_limit_consecutive_seconds=3,
        limit_reached=True,
        observation_complete=True,
        sample_count=60,
        successful_sample_count=60,
    )
    assert evidence.limit_reached


def test_setup_users_follow_attempt_allocate_success_lifecycle() -> None:
    setup = StagingPublicCapacitySetupResult(
        attempted_users=10,
        allocated_users=7,
        successful_users=6,
    )
    assert setup.allocated_users == 7
    with pytest.raises(ValidationError, match="successful_users cannot exceed allocated_users"):
        StagingPublicCapacitySetupResult(
            attempted_users=10,
            allocated_users=5,
            successful_users=6,
        )
    with pytest.raises(ValidationError, match="allocated_users cannot exceed attempted_users"):
        StagingPublicCapacitySetupResult(
            attempted_users=5,
            allocated_users=6,
            successful_users=5,
        )


def test_measurement_window_must_be_ordered_utc() -> None:
    started = datetime(2026, 8, 13, tzinfo=UTC)
    result = StagingPublicCapacityLoadResult(
        requested_users=1,
        measurement_started_at=started,
        measurement_ended_at=started + timedelta(seconds=60),
    )
    assert result.measurement_started_at == started
    with pytest.raises(ValidationError):
        StagingPublicCapacityLoadResult(
            requested_users=1,
            measurement_started_at=started,
            measurement_ended_at=started - timedelta(seconds=1),
        )
    with pytest.raises(ValidationError):
        StagingPublicCapacityLoadResult(
            requested_users=1,
            measurement_started_at=started.astimezone(timezone(timedelta(hours=8))),
            measurement_ended_at=started + timedelta(seconds=60),
        )


def test_result_contract_is_schema_v6_scaling_and_has_no_repeat_or_cv_fields() -> None:
    fields = StagingPublicCapacityResult.model_fields
    assert fields["schema_version"].default == 6
    assert fields["mode"].default == "staging-public-e2e-scaling"
    assert fields["confidence"].default == "single_block_shared_traffic"
    assert "repeated_boundary" not in fields
    assert not any("cv" in name for name in fields)
    stage_fields = StagingPublicCapacityStageResult.model_fields
    assert stage_fields["mode"].default == "staging-public-e2e-scaling-stage"
    assert stage_fields["confidence"].default == "single_block_shared_traffic"


def test_stage_deployment_evidence_rejects_secret_fields() -> None:
    with pytest.raises(ValidationError, match="private field"):
        StagingPublicCapacityStageResult.model_validate(
            {
                "backend_replicas": 1,
                "matrix_complete": False,
                "status": "degraded",
                "environment": {
                    "schema_version": 3,
                },
                "deployment_before": {"agent_api_token": "secret"},
                "deployment_after": {},
                "blocks": [],
                "points": [],
                "assessments": [],
            }
        )

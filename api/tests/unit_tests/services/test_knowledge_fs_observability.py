from __future__ import annotations

from unittest.mock import MagicMock

from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
    KnowledgeFSOperationAdmissionMetric,
    OpenTelemetryKnowledgeFSOperationalMetrics,
)


def test_operational_metrics_use_only_bounded_labels_and_numeric_measurements() -> None:
    meter = MagicMock()
    counters: dict[str, MagicMock] = {}
    histograms: dict[str, MagicMock] = {}
    meter.create_counter.side_effect = lambda name, **_: counters.setdefault(name, MagicMock())
    meter.create_histogram.side_effect = lambda name, **_: histograms.setdefault(name, MagicMock())
    metrics = OpenTelemetryKnowledgeFSOperationalMetrics(meter=meter)

    metrics.record_capability_issuance(
        KnowledgeFSCapabilityIssuanceMetric(
            caller_kind="interactive",
            operation_id="getKnowledgeSpace",
            outcome="issued",
            reason="success",
        )
    )
    metrics.record_batch_status(
        KnowledgeFSBatchStatusMetric(
            duration_seconds=0.25,
            missing_spaces=1,
            outcome="degraded",
            requested_spaces=3,
            returned_spaces=2,
        )
    )
    metrics.record_control_space_state(
        KnowledgeFSControlSpaceStateMetric(
            duration_seconds=12.0,
            from_state="provisioning",
            to_state="active",
        )
    )
    metrics.record_lifecycle_task(
        KnowledgeFSLifecycleTaskMetric(
            duration_seconds=3.5,
            operation="revoke",
            status="succeeded",
        )
    )
    metrics.record_operation_admission(
        KnowledgeFSOperationAdmissionMetric(
            bucket="direct",
            operation_id="createQuery",
            outcome="success",
            phase="commit",
        )
    )

    capability_counter = counters["dify.knowledge_fs.capability_issuance"]
    assert capability_counter.add.call_args.args == (1,)
    assert capability_counter.add.call_args.kwargs == {
        "attributes": {
            "caller_kind": "interactive",
            "operation_id": "getKnowledgeSpace",
            "outcome": "issued",
            "reason": "success",
        }
    }
    all_calls = str(meter.mock_calls)
    assert "tenant_id" not in all_calls
    assert "control_space_id" not in all_calls
    assert "jti" not in all_calls
    assert "token" not in all_calls


def test_control_space_current_state_gauge_uses_bounded_states_and_is_best_effort() -> None:
    meter = MagicMock()
    metrics = OpenTelemetryKnowledgeFSOperationalMetrics(meter=meter)
    read_counts = MagicMock(return_value={"deleting": 2, "error": 1, "provisioning": 3})

    metrics.register_control_space_state_gauge(read_counts)

    gauge_call = meter.create_observable_gauge.call_args
    assert gauge_call.args == ("dify.knowledge_fs.control_spaces",)
    assert gauge_call.kwargs["unit"] == "{space}"
    callback = gauge_call.kwargs["callbacks"][0]
    observations = tuple(callback(MagicMock()))
    assert [(observation.value, observation.attributes) for observation in observations] == [
        (3, {"aggregation_scope": "global_database_snapshot", "state": "provisioning"}),
        (2, {"aggregation_scope": "global_database_snapshot", "state": "deleting"}),
        (1, {"aggregation_scope": "global_database_snapshot", "state": "error"}),
    ]

    assert "aggregate replica series with max, never sum" in gauge_call.kwargs["description"]

    read_counts.side_effect = RuntimeError("database unavailable")
    assert tuple(callback(MagicMock())) == ()
    metrics.register_control_space_state_gauge(read_counts)
    assert meter.create_observable_gauge.call_count == 1

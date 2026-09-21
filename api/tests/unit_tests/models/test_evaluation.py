from models.evaluation import EvaluationRun


def test_evaluation_run_progress_uses_persisted_phase_progress() -> None:
    run = EvaluationRun(
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        target_workflow_version_id="workflow-1",
        evaluation_config_id="config-1",
        config_snapshot="{}",
        total_items=10,
        completed_items=0,
        failed_items=0,
        progress_rate=0.45,
        created_by="account-1",
    )

    assert run.progress == 0.45

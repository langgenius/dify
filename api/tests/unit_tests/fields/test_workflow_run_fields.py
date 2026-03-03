from fields.workflow_run_fields import workflow_run_detail_fields, workflow_run_for_list_fields


def test_workflow_run_list_fields_exclude_heavy_rerun_payloads() -> None:
    assert "rerun_overrides" not in workflow_run_for_list_fields
    assert "rerun_scope" not in workflow_run_for_list_fields


def test_workflow_run_detail_fields_include_rerun_payloads() -> None:
    assert "rerun_overrides" in workflow_run_detail_fields
    assert "rerun_scope" in workflow_run_detail_fields


def test_workflow_run_fields_include_rerun_source_summary() -> None:
    assert "rerun_source_workflow_run" in workflow_run_for_list_fields
    assert "rerun_source_workflow_run" in workflow_run_detail_fields


def test_workflow_run_fields_include_rerun_from_node_title() -> None:
    assert "rerun_from_node_title" in workflow_run_for_list_fields
    assert "rerun_from_node_title" in workflow_run_detail_fields

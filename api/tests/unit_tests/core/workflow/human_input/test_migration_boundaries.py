from pathlib import Path

import pytest


API_ROOT = Path(__file__).resolve().parents[5]


@pytest.mark.parametrize(
    "relative_path",
    [
        "core/entities/execution_extra_content.py",
        "core/workflow/nodes/agent_v2/ask_human_hitl.py",
        "core/workflow/nodes/agent_v2/ask_human_resume.py",
        "repositories/sqlalchemy_execution_extra_content_repository.py",
        "repositories/sqlalchemy_api_workflow_run_repository.py",
        "services/human_input_service.py",
        "services/human_input_file_upload_service.py",
        "services/workflow_service.py",
    ],
)
def test_task1_human_input_semantics_move_off_graphon_imports(relative_path: str) -> None:
    source = (API_ROOT / relative_path).read_text()

    assert "from core.workflow.human_input" in source
    assert "graphon.nodes.human_input" not in source

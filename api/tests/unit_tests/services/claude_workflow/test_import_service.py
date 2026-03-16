from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import yaml

from services.app_dsl_service import Import, ImportMode, ImportStatus
from services.claude_workflow.import_service import ClaudeWorkflowImportExecutionError, ClaudeWorkflowImportService


FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "claude_workflow"


def _account() -> SimpleNamespace:
    return SimpleNamespace(current_tenant_id="tenant-1")


def _fixture_text(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def test_import_app_compiles_claude_workflow_before_delegating_to_app_dsl_service() -> None:
    dsl_service = MagicMock()
    dsl_service.import_app.return_value = Import(
        id="import-1",
        status=ImportStatus.COMPLETED,
        app_id="app-1",
        app_mode="workflow",
    )
    service = ClaudeWorkflowImportService(MagicMock(), dsl_service=dsl_service)

    result = service.import_app(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT,
        yaml_content=_fixture_text("basic_llm.yml"),
    )

    assert result.app_id == "app-1"
    forwarded_yaml = dsl_service.import_app.call_args.kwargs["yaml_content"]
    compiled = yaml.safe_load(forwarded_yaml)
    assert compiled["kind"] == "app"
    assert compiled["workflow"]["graph"]["nodes"][1]["id"] == "summarize"


def test_import_app_returns_schema_failure_as_http_400_payload() -> None:
    service = ClaudeWorkflowImportService(MagicMock(), dsl_service=MagicMock())

    with pytest.raises(ClaudeWorkflowImportExecutionError) as exc_info:
        service.import_app(
            account=_account(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=_fixture_text("invalid_missing_edge_target.yml"),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.payload.status == ImportStatus.FAILED
    assert "edges.1.target" in exc_info.value.payload.error


def test_import_app_returns_compiler_failure_as_http_422_payload() -> None:
    malformed = yaml.safe_load(_fixture_text("http_request.yml"))
    malformed["nodes"][0]["url"] = {"selector": ["start"]}
    service = ClaudeWorkflowImportService(MagicMock(), dsl_service=MagicMock())

    with pytest.raises(ClaudeWorkflowImportExecutionError) as exc_info:
        service.import_app(
            account=_account(),
            import_mode=ImportMode.YAML_CONTENT,
            yaml_content=yaml.safe_dump(malformed, sort_keys=False, allow_unicode=True),
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.payload.status == ImportStatus.FAILED
    assert "Invalid selector payload" in exc_info.value.payload.error
